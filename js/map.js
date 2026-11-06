import { destination, surfaceWavefrontRadiusKm, clamp } from './physics.js';

const TILE = 256;
const TILE_SERVERS = {street:'https://tile.openstreetmap.org',satellite:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'};
const toWorld = (lat, lon, zoom) => {
  const scale = TILE * 2 ** zoom;
  const sinLat = Math.sin(clamp(lat, -85.051128, 85.051128) * Math.PI / 180);
  return {x: (lon + 180) / 360 * scale, y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) / 1 * scale};
};
const fromWorld = (x, y, zoom) => {
  const scale = TILE * 2 ** zoom;
  const n = Math.PI * (1 - 2 * y / scale);
  return {longitude: x / scale * 360 - 180, latitude: Math.atan(Math.sinh(n)) * 180 / Math.PI};
};
export class EEWMap {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect;
    this.lat = 35.43;
    this.lon = -117.77;
    this.zoom = 8;
    this.dpr = 1;
    this.tiles = new Map();
    this.data = null;
    this.results = null;
    this.elapsed = 0;
    this.selection = null;
    this.showP = true;
    this.showS = true;
    this.showStations = true;
    this.showLabels = true;
    this.manualStationPreview = null;
    this.baseStyle = 'satellite';
    this.observed = new Map();
    this.showBaselineWavefront = true;
    this.importanceEnabled = false;
    this.impactValues = new Map();
    this.candidateEnabled = false;
    this.candidateCells = [];
    this.candidateSource = null;
    this.candidateGrid = null;
    this.candidateRaster = null;
    this.candidateDisplay = 'smooth';
    this.onCandidateHover = null;
    this.pointer = null;
    this.hover = null;
    this.hitTargets = [];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindInput();
    this.resize();
  }
  resize() {
    const box = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, box.width); this.height = Math.max(1, box.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.render();
  }
  worldCenter() { return toWorld(this.lat, this.lon, this.zoom); }
  screenPosition(lat, lon) {
    const center = this.worldCenter(), coord = toWorld(lat, lon, this.zoom);
    return {x: this.width / 2 + coord.x - center.x, y: this.height / 2 + coord.y - center.y};
  }
  screenToGeo(x, y) {
    const center = this.worldCenter();
    return fromWorld(center.x + x - this.width / 2, center.y + y - this.height / 2, this.zoom);
  }
  changeZoom(delta, x = this.width / 2, y = this.height / 2) {
    const before = this.screenToGeo(x, y);
    this.zoom = clamp(this.zoom + delta, 5, 13);
    const afterW = toWorld(before.latitude, before.longitude, this.zoom);
    const centerNew = {x: afterW.x - (x - this.width/2), y: afterW.y - (y - this.height/2)};
    const geo = fromWorld(centerNew.x, centerNew.y, this.zoom);
    this.lat = geo.latitude; this.lon = geo.longitude;
    this.render();
  }
  focus(lat, lon, zoom = this.zoom) { this.lat = lat; this.lon = lon; this.zoom = zoom; this.render(); }
  setCandidateGrid(grid) {
    this.candidateGrid=grid;
    this.candidateCells=grid?.cells??[];
    this.candidateRaster=null;
    if(!grid)return;
    const raster=document.createElement('canvas');
    raster.width=grid.cols;raster.height=grid.rows;
    const rc=raster.getContext('2d');
    const img=rc.createImageData(grid.cols,grid.rows);
    for(let i=0;i<grid.cells.length;i++){
      const color=grid.cells[i].overlayColor||'rgba(27,55,157,.5)';
      const rgba=color.match(/[\d.]+/g)?.map(Number)||[27,55,157,.5];
      img.data[i*4]=rgba[0];img.data[i*4+1]=rgba[1];img.data[i*4+2]=rgba[2];img.data[i*4+3]=Math.round((rgba[3]??1)*255);
    }
    rc.putImageData(img,0,0);
    this.candidateRaster=raster;
  }
  candidateCellAt(x,y){
    const g=this.candidateGrid;
    if(!this.candidateEnabled||!g)return null;
    const ll=this.screenToGeo(x,y);
    const c=Math.round((ll.longitude-g.bounds.minLon)/g.stepDeg);
    const r=Math.round((g.bounds.maxLat-ll.latitude)/g.stepDeg);
    if(r<0||c<0||r>=g.rows||c>=g.cols)return null;
    return g.cells[r*g.cols+c]??null;
  }
  bindInput() {
    this.canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      const rect=this.canvas.getBoundingClientRect();
      const x=e.clientX-rect.left,y=e.clientY-rect.top;
      if(x>=0&&x<=this.width&&y>=0&&y<=this.height)this.onMapRightClick?.(this.screenToGeo(x,y));
    });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.changeZoom(e.deltaY < 0 ? .4 : -.4, e.clientX - rect.left, e.clientY - rect.top);
    }, {passive:false});
    this.canvas.addEventListener('pointerdown', e => {
      if(e.button!==0)return;
      this.pointer = {x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY, moved:false, center:this.worldCenter()};
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove', e => {
      if (this.pointer) {
        const dx = e.clientX - this.pointer.x, dy = e.clientY - this.pointer.y;
        if (Math.abs(e.clientX - this.pointer.startX) + Math.abs(e.clientY - this.pointer.startY) > 4) this.pointer.moved = true;
        const geo = fromWorld(this.pointer.center.x - dx, this.pointer.center.y - dy, this.zoom);
        this.lat = geo.latitude; this.lon = geo.longitude;
        this.render();
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        this.hover = this.hitTargets.find(t => Math.hypot(t.x - x, t.y - y) < t.r + 5) ?? null;
        this.canvas.style.cursor = this.hover ? 'pointer' : 'grab';
        this.onCandidateHover?.(this.hover?null:this.candidateCellAt(x,y),x,y);
      }
    });
    this.canvas.addEventListener('pointerup', e => {
      if (this.pointer && !this.pointer.moved) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const hit = [...this.hitTargets].reverse().find(t => Math.hypot(t.x-x,t.y-y) < t.r+7);
        if (hit) this.onSelect(hit.kind, hit.id, hit.payload);
        else {const cell=this.candidateCellAt(x,y);if(cell)this.onSelect('candidate','candidate',cell);}
      }
      this.pointer = null; this.canvas.classList.remove('dragging');
    });
    this.canvas.addEventListener('pointercancel', () => {this.pointer=null;this.canvas.classList.remove('dragging');});
    this.canvas.addEventListener('pointerleave',()=>this.onCandidateHover?.(null,0,0));
  }
  render() {
    if (!this.width || !this.height) return;
    const c = this.ctx; c.setTransform(this.dpr,0,0,this.dpr,0,0);
    c.clearRect(0,0,this.width,this.height);
    c.fillStyle='#eaf2f3'; c.fillRect(0,0,this.width,this.height);
    if (this.baseStyle === 'grid') this.drawGrid(c);
    else this.drawTiles(c);
    if (!this.data) return;
    const ev = this.data.event;
    const satellite = this.baseStyle === 'satellite';
    if (this.showP && this.showBaselineWavefront) this.drawWavefront(c, ev, this.elapsed, this.results?.params?.vpKmS ?? this.data.model.vpKmS, satellite?'#8ecde0':'#0b758e', satellite?2.6:2.0, [7,5]);
    if (this.showS && this.showBaselineWavefront) this.drawWavefront(c, ev, this.elapsed, this.results?.params?.vsKmS ?? this.data.model.vsKmS, satellite?'#e7c08d':'#b8823a', satellite?3.0:2.5, []);
    this.hitTargets=[];
    if (this.candidateEnabled && this.candidateCells?.length) this.drawCandidateCells(c);
    for (const city of this.results?.cities ?? []) this.drawCity(c,city);
    if (this.showStations) for (const station of this.results?.stations ?? []) this.drawStation(c,station);
    this.drawEpicenter(c,ev);
    if (this.candidateEnabled && this.candidateSource && (Math.abs(this.candidateSource.latitude-ev.latitude)>1e-5||Math.abs(this.candidateSource.longitude-ev.longitude)>1e-5)) this.drawCandidateSource(c,this.candidateSource);
    if(this.manualStationPreview)this.drawInactiveStation(c,this.manualStationPreview);
  }
  drawGrid(c) {
    c.strokeStyle = '#c1d3d7';c.lineWidth = .75;
    const tl = this.screenToGeo(0,0), br = this.screenToGeo(this.width,this.height);
    const stride=this.zoom>=9?.25:this.zoom>=7?.5:1;
    c.font='11px Arial, system-ui, sans-serif';
    for(let lon=Math.ceil(tl.longitude/stride)*stride;lon<=br.longitude;lon+=stride) {
      let a=this.screenPosition(this.lat,lon);
      c.beginPath();c.moveTo(a.x,0);c.lineTo(a.x,this.height);c.stroke();
      c.fillStyle='#72949a';c.fillText(`${Math.abs(lon).toFixed(1)}°W`,a.x+6,20);
    }
    for(let lat=Math.ceil(br.latitude/stride)*stride;lat<=tl.latitude;lat+=stride) {
      let a=this.screenPosition(lat,this.lon);
      c.beginPath();c.moveTo(0,a.y);c.lineTo(this.width,a.y);c.stroke();
      c.fillStyle='#72949a';c.fillText(`${lat.toFixed(1)}°N`,9,a.y-5);
    }
  }
  drawTiles(c) {
    const z = Math.floor(this.zoom), ratio=2**(this.zoom-z), count=2**z, tileSize=TILE*ratio;
    const center=toWorld(this.lat,this.lon,z), ox=this.width/2-center.x*ratio,oy=this.height/2-center.y*ratio;
    const minX=Math.floor((0-ox)/tileSize), maxX=Math.floor((this.width-ox)/tileSize);
    const minY=Math.floor((0-oy)/tileSize), maxY=Math.floor((this.height-oy)/tileSize);
    let requested=0;
    for(let x=minX;x<=maxX;x++) for(let y=minY;y<=maxY;y++){
      if(y<0||y>=count)continue;
      const normalizedX=((x%count)+count)%count, key=`${this.baseStyle}/${z}/${normalizedX}/${y}`;
      let img=this.tiles.get(key);
      if (!img && requested++<35) {
        img=new Image(); img.crossOrigin='anonymous';
        img.onload=()=>this.render(); img.onerror=()=>{img.failed=true;this.render();};
        img.src=this.baseStyle==='satellite'?`${TILE_SERVERS.satellite}/${z}/${y}/${normalizedX}`:`${TILE_SERVERS.street}/${z}/${normalizedX}/${y}.png`;
        this.tiles.set(key,img);
      }
      if(img?.complete && img.naturalWidth>0) {
        c.save();c.globalAlpha=1;
        c.drawImage(img,ox+x*tileSize,oy+y*tileSize,tileSize+1,tileSize+1);
        c.restore();
      }
    }
    if(this.tiles.size>250){for(const k of [...this.tiles.keys()].slice(0,70))this.tiles.delete(k);}
  }
  drawWavefront(c,event,t,velocity,color,width,dash) {
    const r = surfaceWavefrontRadiusKm(t,event.depthKm,velocity);
    if(r===null || r===0)return;
    c.save(); c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);
    c.beginPath();
    for(let b=0;b<=360;b+=3){const ll=destination(event.latitude,event.longitude,b,r);const p=this.screenPosition(ll.latitude,ll.longitude);if(b===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);}
    c.closePath();c.stroke(); c.restore();
  }
  drawCandidateCells(c){
    const g=this.candidateGrid;
    if(this.candidateDisplay==='smooth'&&this.candidateRaster&&g){
      const half=g.stepDeg/2;
      const nw=this.screenPosition(g.bounds.maxLat+half,g.bounds.minLon-half);
      const se=this.screenPosition(g.bounds.maxLat-(g.rows-1)*g.stepDeg-half,g.bounds.minLon+(g.cols-1)*g.stepDeg+half);
      c.save();
      c.imageSmoothingEnabled=true;
      c.imageSmoothingQuality='high';
      c.drawImage(this.candidateRaster,nw.x,nw.y,se.x-nw.x,se.y-nw.y);
      c.restore();
      return;
    }
    c.save();
    for(const cell of this.candidateCells){
      const half=cell.stepDeg/2;
      const nw=this.screenPosition(cell.lat+half,cell.lon-half);
      const se=this.screenPosition(cell.lat-half,cell.lon+half);
      const x=Math.min(nw.x,se.x),y=Math.min(nw.y,se.y),w=Math.abs(se.x-nw.x),h=Math.abs(se.y-nw.y);
      if(x>this.width||y>this.height||x+w<0||y+h<0)continue;
      c.fillStyle=cell.overlayColor||'rgba(27,55,157,.48)';
      c.fillRect(Math.floor(x),Math.floor(y),Math.ceil(x+w)-Math.floor(x),Math.ceil(y+h)-Math.floor(y));
    }
    c.restore();
  }
  drawInactiveStation(c,station){
    const p=this.screenPosition(station.latitude,station.longitude);
    if(p.x<-20||p.y<-20||p.x>this.width+20||p.y>this.height+20)return;
    c.save();c.fillStyle='#c7cdd1';c.strokeStyle='#53636a';c.lineWidth=1.5;
    c.beginPath();c.moveTo(p.x,p.y-8);c.lineTo(p.x+8,p.y);c.lineTo(p.x,p.y+8);c.lineTo(p.x-8,p.y);c.closePath();c.fill();c.stroke();
    c.font='600 10px Arial,system-ui';c.fillStyle=this.baseStyle==='satellite'?'#fff':'#43545b';c.shadowColor=this.baseStyle==='satellite'?'#000':'#fff';c.shadowBlur=5;c.fillText('NEW1',p.x+10,p.y+4);c.restore();
  }
  drawEpicenter(c,event){
    const p=this.screenPosition(event.latitude,event.longitude);if(p.x<-30||p.x>this.width+30||p.y<-30||p.y>this.height+30)return;
    c.save();c.translate(p.x,p.y);
    c.strokeStyle='#bc5353';c.lineWidth=1.2;c.globalAlpha=.44;
    c.beginPath();c.arc(0,0,19,0,Math.PI*2);c.stroke();c.globalAlpha=1;
    c.fillStyle='#c75151';c.strokeStyle='#ffffff';c.lineWidth=1.8;
    c.beginPath();c.moveTo(0,-9);c.lineTo(8,6);c.lineTo(-8,6);c.closePath();c.fill();c.stroke();
    c.fillStyle=this.baseStyle==='satellite'?'#ffffff':'#7d2932';c.font='700 11px Arial,system-ui';c.shadowColor=this.baseStyle==='satellite'?'#000000':'#ffffff';c.shadowBlur=5;c.fillText('Mw '+event.magnitude.toFixed(1),14,-10);
    c.restore();this.hitTargets.push({kind:'event',id:event.id,x:p.x,y:p.y,r:15});
  }
  drawCandidateSource(c,source){
    const p=this.screenPosition(source.latitude,source.longitude);
    if(p.x<-24||p.x>this.width+24||p.y<-24||p.y>this.height+24)return;
    c.save();
    c.strokeStyle='#5a4ca2';c.lineWidth=1.8;c.fillStyle='#ffffff';
    c.beginPath();c.arc(p.x,p.y,8,0,Math.PI*2);c.fill();c.stroke();
    c.beginPath();c.moveTo(p.x-8,p.y);c.lineTo(p.x+8,p.y);c.moveTo(p.x,p.y-8);c.lineTo(p.x,p.y+8);c.stroke();
    c.fillStyle=this.baseStyle==='satellite'?'#ffffff':'#453f6d';c.font='700 10px Arial,system-ui';c.shadowColor=this.baseStyle==='satellite'?'#000000':'#ffffff';c.shadowBlur=5;c.fillText('Source',p.x+10,p.y-9);
    c.restore();
  }
  drawCity(c,city){
    const p=this.screenPosition(city.latitude,city.longitude);
    if(p.x<-70||p.x>this.width+70||p.y<-30||p.y>this.height+30)return;
    const active=this.selection?.kind==='city'&&this.selection.id===city.id;
    c.save();c.beginPath();c.arc(p.x,p.y,active?5.3:3.5,0,Math.PI*2);
    c.fillStyle=active?'#79c9d7':this.baseStyle==='satellite'?'#ffffff':'#2b5260';c.strokeStyle='#17323a';c.lineWidth=1.2;c.fill();c.stroke();
    c.font=`${active?'700':'500'} 11px Inter,system-ui`;
    c.shadowColor=this.baseStyle==='satellite'?'#000000':'#ffffff';c.shadowBlur=6;c.fillStyle=this.baseStyle==='satellite'?'#ffffff':'#2d4a56';c.fillText(city.name,p.x+8,p.y-7);
    c.restore();this.hitTargets.push({kind:'city',id:city.id,x:p.x,y:p.y,r:9});
  }
  drawStation(c,station){
    const p=this.screenPosition(station.latitude,station.longitude);
    if(p.x<-20||p.x>this.width+20||p.y<-20||p.y>this.height+20)return;
    const selected=this.selection?.kind==='station'&&this.selection.id===station.id;
    const simulated=!!station.simulated;
    const arrival = station.available!==null && this.elapsed>=station.available ? '#3f947c' : station.p!==null && this.elapsed>=station.p?'#c59c58':'#359ab1';
    const cell=this.importanceEnabled?this.impactValues.get(station.id):null;
    const severity=cell?.status==='lost'?'#9b4542':cell?.status==='unavailable'||cell?.status==='missing'?'#edf0f1':cell?.status==='disabled'?'#a0a8ad':!cell?.delta?'#ffffff':cell.delta<.5?'#d8eaee':cell.delta<1.5?'#a8d1d9':cell.delta<3?'#62acbb':'#006d82';
    const color=station.enabled?(this.importanceEnabled?severity:arrival):'#a0a8ad';
    c.save();c.fillStyle=color;c.strokeStyle=this.importanceEnabled?'#294f5f':'#ffffff';c.lineWidth=1.5;
    if(selected){c.beginPath();c.arc(p.x,p.y,10,0,Math.PI*2);c.strokeStyle='#063f5c';c.stroke();}
    if(simulated){
      c.fillStyle=station.enabled?'#ffd45c':'#b5b8bc';c.strokeStyle='#263a4e';c.lineWidth=2;
      c.beginPath();c.moveTo(p.x,p.y-9);c.lineTo(p.x+9,p.y);c.lineTo(p.x,p.y+9);c.lineTo(p.x-9,p.y);c.closePath();c.fill();c.stroke();
    }else{c.beginPath();c.rect(p.x-4,p.y-4,8,8);c.fill();c.stroke();}
    if(this.observed?.has(station.id)){c.strokeStyle='#efc77d';c.lineWidth=1.4;c.strokeRect(p.x-6.5,p.y-6.5,13,13);}
    if(simulated || (this.showLabels && this.zoom >= 9) || selected){c.font='600 10px Arial,system-ui';c.shadowColor=this.baseStyle==='satellite'?'#000000':'#ffffff';c.shadowBlur=6;c.fillStyle=this.baseStyle==='satellite'?'#ffffff':'#1a4e65';c.fillText(station.code,p.x+8,p.y+4);}
    c.restore();this.hitTargets.push({kind:'station',id:station.id,x:p.x,y:p.y,r:simulated?12:8});
  }
}
