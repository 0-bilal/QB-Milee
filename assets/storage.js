/**
* التخزين المحلي (قابل للاستبدال لاحقًا بمكالمات Google Apps Script).
* واجهة موحّدة يستخدمها app.js بدون القلق عن مصدر البيانات.
*/
(function(global){
const NS = 'fueltracker.v1';
const KEYS = {
vehicles: `${NS}:vehicles`,
fuelLogs: `${NS}:fuelLogs`,
serviceLogs: `${NS}:serviceLogs`
};


function read(key){
try{ return JSON.parse(localStorage.getItem(key)||'[]'); }
catch(e){ console.warn('Storage parse error', key, e); return []; }
}
function write(key, arr){ localStorage.setItem(key, JSON.stringify(arr)); }
function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }


const storage = {
// Vehicles
listVehicles(){ return read(KEYS.vehicles); },
saveVehicle(v){
const list = read(KEYS.vehicles);
if(!v.id){ v.id = uid(); list.push(v); }
else {
const i = list.findIndex(x=>x.id===v.id);
if(i>=0) list[i]=v; else list.push(v);
}
write(KEYS.vehicles,list); return v;
},
deleteVehicle(id){
write(KEYS.vehicles, read(KEYS.vehicles).filter(v=>v.id!==id));
// cascade delete fuel & services of this vehicle
write(KEYS.fuelLogs, read(KEYS.fuelLogs).filter(f=>f.vehicleId!==id));
write(KEYS.serviceLogs, read(KEYS.serviceLogs).filter(s=>s.vehicleId!==id));
},


// Fuel logs
listFuelLogs(){ return read(KEYS.fuelLogs).sort((a,b)=>a.date.localeCompare(b.date)); },
saveFuelLog(f){
const list = read(KEYS.fuelLogs);
if(!f.id){ f.id = uid(); list.push(f); }
else { const i=list.findIndex(x=>x.id===f.id); if(i>=0) list[i]=f; else list.push(f); }
write(KEYS.fuelLogs,list); return f;
},
deleteFuelLog(id){ write(KEYS.fuelLogs, read(KEYS.fuelLogs).filter(f=>f.id!==id)); },


// Service logs
listServiceLogs(){ return read(KEYS.serviceLogs).sort((a,b)=>a.date.localeCompare(b.date)); },
saveServiceLog(s){
const list = read(KEYS.serviceLogs);
if(!s.id){ s.id = uid(); list.push(s); }
else { const i=list.findIndex(x=>x.id===s.id); if(i>=0) list[i]=s; else list.push(s); }
write(KEYS.serviceLogs,list); return s;
},
deleteServiceLog(id){ write(KEYS.serviceLogs, read(KEYS.serviceLogs).filter(s=>s.id!==id)); }
};


global.FuelStore = storage;
})(window);