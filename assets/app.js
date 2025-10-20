(function(){
  const $ = (sel,root=document)=>root.querySelector(sel);
  const $$ = (sel,root=document)=>Array.from(root.querySelectorAll(sel));

  // الحالة العامة (تُقرأ من التخزين عند التحميل)
  let state = {
    vehicles: [],
    fuelLogs: [],
    serviceLogs: [],
    filters: { vehicleId: 'all' }
  };

  // تنسيقات بسيطة
  const fmt = {
    num:(n,d=0)=> (n==null||isNaN(n))?'-':Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}),
    date:(s)=> s ? s : '-',
    sar:(n)=> (n==null||isNaN(n))?'-':`${Number(n).toFixed(2)} ر.س`,
  };

  // قراءة/كتابة من التخزين
  function load(){
    state.vehicles = FuelStore.listVehicles();
    state.fuelLogs = FuelStore.listFuelLogs();
    state.serviceLogs = FuelStore.listServiceLogs();
  }

  // أدوات
  function byVehicle(id){ return state.vehicles.find(v=>v.id===id); }
  function vehicleName(id){ return byVehicle(id)?.name || '—'; }

  // حساب الاستهلاك Full-to-Full لكل مركبة
  function computeFuelStats(vehicleId){
    const logs = state.fuelLogs.filter(f=>f.vehicleId===vehicleId).sort((a,b)=>a.date.localeCompare(b.date));
    let lastFull = null;
    let stats = { samples:0, totalKm:0, totalLiters:0, avgKmPerL:null, avgLPer100:null, costPerKm:null };

    for(const f of logs){
      if(f.isFullTank){
        if(lastFull){
          const dist = Number(f.odometer) - Number(lastFull.odometer);
          const liters = Number(f.liters);
          if(dist>0 && liters>0){
            stats.samples++;
            stats.totalKm += dist;
            stats.totalLiters += liters;
          }
        }
        lastFull = f;
      }
    }
    if(stats.samples>0){
      const avgKmPerL = stats.totalKm / stats.totalLiters; // km/L
      const avgLPer100 = (stats.totalLiters / stats.totalKm) * 100; // L/100km
      // التكلفة/كم بحساب متوسط سعر اللتر عبر كل السجلات
      const vehLogs = logs.filter(x=>x.pricePerLiter||x.totalCost);
      let totalCost=0, totalKmForCost=0;
      lastFull=null;
      for(const f of logs){
        if(f.isFullTank){
          if(lastFull){
            const dist = Number(f.odometer) - Number(lastFull.odometer);
            if(dist>0){
              const cost = f.totalCost ?? ( (f.pricePerLiter||0) * (f.liters||0) );
              totalCost += (Number(cost)||0);
              totalKmForCost += dist;
            }
          }
          lastFull = f;
        }
      }
      const costPerKm = totalKmForCost>0 ? (totalCost/totalKmForCost) : null;
      stats.avgKmPerL = avgKmPerL; stats.avgLPer100 = avgLPer100; stats.costPerKm = costPerKm;
    }
    return stats;
  }

  // تقدير الاستحقاق للصيانة: الأقرب من المسافة/الزمن
  function computeServiceAlerts(){
    const alerts = [];
    const today = new Date().toISOString().slice(0,10);

    for(const v of state.vehicles){
      // آخر خدمات لكل نوع
      const sByKind = {};
      state.serviceLogs.filter(s=>s.vehicleId===v.id).forEach(s=>{ sByKind[s.kind] = s; });

      const rules = vehicleRules(v);
      for(const r of rules){
        const last = sByKind[r.kind];
        if(!last) continue; // لا تنبيه إن لم تُسجّل أبداً

        const nextOdo = (Number(last.odometer)||0) + (r.intervalKm||Infinity);
        const nextDate = addMonths(last.date, r.intervalMonths||0);

        const currentOdo = latestOdometer(v.id) ?? (Number(last.odometer)||0);
        const kmLeft = isFinite(nextOdo) ? (nextOdo - currentOdo) : Infinity;
        const daysLeft = r.intervalMonths ? diffDays(today, nextDate) : Infinity;

        const thresholdKm = 500; // إنذار مبكر
        const thresholdDays = 10;
        let status=null, note='';

        if(kmLeft<=0 || daysLeft<=0){ status='due'; }
        else if(kmLeft<=thresholdKm || daysLeft<=thresholdDays){ status='warn'; }

        if(status){
          note = `التالي عند ${isFinite(nextOdo)?fmt.num(nextOdo):'—'} كم أو ${nextDate||'—'}`;
          alerts.push({ vehicle:v.name, kind:kindLabel(r.kind), status, kmLeft, daysLeft, note });
        }
      }
    }
    return alerts.sort((a,b)=> (a.status==='due'?0:1) - (b.status==='due'?0:1));
  }

  function vehicleRules(v){
    // قواعد افتراضية من بطاقة المركبة (محفوظة داخلها)
    const r = [];
    if(v.oil_km || v.oil_months){ r.push({kind:'engine_oil', intervalKm:+v.oil_km||Infinity, intervalMonths:+v.oil_months||0}); }
    if(v.gear_km || v.gear_months){ r.push({kind:'gear_oil', intervalKm:+v.gear_km||Infinity, intervalMonths:+v.gear_months||0}); }
    return r;
  }

  function kindLabel(k){
    return ({engine_oil:'زيت المحرك', gear_oil:'زيت القير', air_filter:'فلتر الهواء', ac_filter:'فلتر المكيف', other:'أخرى'})[k]||k;
  }

  function latestOdometer(vehicleId){
    const logs = state.fuelLogs.filter(f=>f.vehicleId===vehicleId).sort((a,b)=>b.date.localeCompare(a.date));
    return logs[0]?.odometer ?? null;
  }

  function addMonths(dateStr, months){
    if(!months) return null;
    const d = new Date(dateStr+'T00:00:00');
    d.setMonth(d.getMonth()+months);
    return d.toISOString().slice(0,10);
  }
  function diffDays(a,b){
    if(!a||!b) return Infinity;
    const d1 = new Date(a+'T00:00:00');
    const d2 = new Date(b+'T00:00:00');
    return Math.ceil((d2-d1)/(1000*60*60*24));
  }

  // ==== العرض ====
  function render(){
    renderFilters();
    renderSummary();
    renderAlerts();
    renderVehiclesTable();
    renderFuelTable();
    renderServiceTable();
  }

  function renderFilters(){
    const vehSel = $('#vehicle-filter');
    const fuelSel = $('#fuel-vehicle-filter');
    const srvSel = $('#service-vehicle-filter');
    [vehSel,fuelSel,srvSel].forEach(sel=>{
      if(!sel) return;
      sel.innerHTML = `<option value="all">جميع المركبات</option>` + state.vehicles.map(v=>`<option value="${v.id}">${v.name}</option>`).join('');
      sel.value = state.filters.vehicleId || 'all';
      sel.onchange = (e)=>{ state.filters.vehicleId = e.target.value; render(); };
    });
  }

  function renderSummary(){
    const box = $('#summary');
    if(!state.vehicles.length){ box.innerHTML = $('#tpl-empty').content.firstElementChild.outerHTML; return; }

    const vids = state.filters.vehicleId==='all' ? state.vehicles.map(v=>v.id) : [state.filters.vehicleId];
    const kp = [];
    let totalMonthlyCost = 0;

    for(const vid of vids){
      const v = byVehicle(vid);
      const st = computeFuelStats(vid);
      const name = v?.name || '—';
      // تكلفة شهرية تقريبية من آخر 30 يومًا
      const thiryAgo = new Date(); thiryAgo.setDate(thiryAgo.getDate()-30);
      const monthLogs = state.fuelLogs.filter(f=>f.vehicleId===vid && new Date(f.date+'T00:00:00')>=thiryAgo);
      const monthCost = monthLogs.reduce((s,x)=> s + (x.totalCost ?? ((x.pricePerLiter||0)*(x.liters||0))), 0);
      totalMonthlyCost += monthCost;

      kp.push(`
        <div class="kpi">
          <span class="label">${name} — اقتصاد (كم/لتر)</span>
          <div class="val">${fmt.num(st.avgKmPerL,2)}</div>
        </div>
        <div class="kpi">
          <span class="label">${name} — (لتر/100كم)</span>
          <div class="val">${fmt.num(st.avgLPer100,2)}</div>
        </div>
        <div class="kpi">
          <span class="label">${name} — تكلفة/كم</span>
          <div class="val">${st.costPerKm?fmt.sar(st.costPerKm):'-'}</div>
        </div>
        <div class="kpi">
          <span class="label">${name} — تكلفة 30 يوم</span>
          <div class="val">${fmt.sar(monthCost)}</div>
        </div>
      `);
    }
    box.innerHTML = kp.join('');
  }

  function renderAlerts(){
    const list = $('#alerts');
    const alerts = computeServiceAlerts();
    if(!alerts.length){ list.innerHTML = '<li class="alert">لا توجد تنبيهات حالياً.</li>'; return; }
    list.innerHTML = alerts.map(a=>`
      <li class="alert ${a.status==='due'?'due':''}">
        <strong>${a.vehicle}</strong> — ${a.kind}
        <div class="label">${a.note}</div>
        <div class="badge">المتبقي بالكم: ${isFinite(a.kmLeft)?fmt.num(a.kmLeft):'—'}</div>
        <div class="badge">المتبقي أيام: ${isFinite(a.daysLeft)?fmt.num(a.daysLeft):'—'}</div>
      </li>
    `).join('');
  }

  function renderVehiclesTable(){
    const tbody = $('#vehicle-rows');
    if(!state.vehicles.length){ tbody.innerHTML = `<tr><td colspan="5">${$('#tpl-empty').content.firstElementChild.outerHTML}</td></tr>`; return; }
    const rows = state.vehicles.map(v=>`
      <tr>
        <td>${v.name}</td>
        <td>${fmt.num(v.tankCapacity,1)}</td>
        <td>${v.fuelType}</td>
        <td>${fmt.num(v.odoStart||0)}</td>
        <td class="row-actions">
          <button class="btn" data-edit-vehicle="${v.id}">تعديل</button>
          <button class="btn danger" data-del-vehicle="${v.id}">حذف</button>
        </td>
      </tr>
    `).join('');
    tbody.innerHTML = rows;

    // أحداث
    $$('[data-edit-vehicle]').forEach(b=> b.onclick = ()=> openVehicleModal(b.dataset.editVehicle));
    $$('[data-del-vehicle]').forEach(b=> b.onclick = ()=> { if(confirm('حذف المركبة وجميع سجلاتها؟')){ FuelStore.deleteVehicle(b.dataset.delVehicle); reload(); } });
  }

  function renderFuelTable(){
    const tbody = $('#fuel-rows');
    let logs = state.fuelLogs;
    if(state.filters.vehicleId!=='all') logs = logs.filter(f=>f.vehicleId===state.filters.vehicleId);
    if(!logs.length){ tbody.innerHTML = `<tr><td colspan="8">${$('#tpl-empty').content.firstElementChild.outerHTML}</td></tr>`; return; }
    tbody.innerHTML = logs.map(f=>`
      <tr>
        <td>${fmt.date(f.date)}</td>
        <td>${vehicleName(f.vehicleId)}</td>
        <td>${fmt.num(f.odometer)}</td>
        <td>${fmt.num(f.liters,2)} <span class="badge ${f.isFullTank?'full':''}">${f.isFullTank?'كامل':''}</span></td>
        <td>${f.isFullTank?'نعم':'لا'}</td>
        <td>${f.pricePerLiter?fmt.sar(f.pricePerLiter):'-'}</td>
        <td>${f.totalCost?fmt.sar(f.totalCost):'-'}</td>
        <td>${f.notes||''}</td>
      </tr>
    `).join('');
  }

  function renderServiceTable(){
    const tbody = $('#service-rows');
    let logs = state.serviceLogs;
    if(state.filters.vehicleId!=='all') logs = logs.filter(s=>s.vehicleId===state.filters.vehicleId);
    if(!logs.length){ tbody.innerHTML = `<tr><td colspan="6">${$('#tpl-empty').content.firstElementChild.outerHTML}</td></tr>`; return; }
    tbody.innerHTML = logs.map(s=>`
      <tr>
        <td>${fmt.date(s.date)}</td>
        <td>${vehicleName(s.vehicleId)}</td>
        <td>${kindLabel(s.kind)}</td>
        <td>${fmt.num(s.odometer)}</td>
        <td>
          <span class="badge">${s.intervalKm?fmt.num(s.intervalKm)+' كم':''}</span>
          <span class="badge">${s.intervalMonths?s.intervalMonths+' أشهر':''}</span>
        </td>
        <td>${s.notes||''}</td>
      </tr>
    `).join('');
  }

  // ==== النماذج (Modals) ====
  const modVehicle = $('#modal-vehicle');
  const modFuel = $('#modal-fuel');
  const modService = $('#modal-service');

  function openVehicleModal(id){
    const form = $('#form-vehicle');
    form.reset();
    if(id){
      const v = byVehicle(id);
      form.id.value = v.id;
      form.name.value = v.name;
      form.tankCapacity.value = v.tankCapacity;
      form.fuelType.value = v.fuelType;
      form.odoStart.value = v.odoStart??'';
      form.oil_km.value = v.oil_km??8000;
      form.oil_months.value = v.oil_months??6;
      form.gear_km.value = v.gear_km??60000;
      form.gear_months.value = v.gear_months??24;
    }
    modVehicle.showModal();
  }

  function openFuelModal(){
    const form = $('#form-fuel');
    form.reset();
    form.date.valueAsDate = new Date();
    // تعبئة قائمة المركبات
    const sel = form.vehicleId; sel.innerHTML = state.vehicles.map(v=>`<option value="${v.id}">${v.name}</option>`).join('');
    modFuel.showModal();
  }

  function openServiceModal(){
    const form = $('#form-service');
    form.reset();
    form.date.valueAsDate = new Date();
    const sel = form.vehicleId; sel.innerHTML = state.vehicles.map(v=>`<option value="${v.id}">${v.name}</option>`).join('');
    modService.showModal();
  }

  // حفظ النماذج
  $('#form-vehicle').onsubmit = (e)=>{
    if(e.submitter?.value!=="confirm") return; e.preventDefault();
    const f = e.target;
    const v = {
      id: f.id.value || undefined,
      name: f.name.value.trim(),
      tankCapacity: +f.tankCapacity.value,
      fuelType: f.fuelType.value,
      odoStart: f.odoStart.value? +f.odoStart.value : null,
      oil_km: f.oil_km.value? +f.oil_km.value : null,
      oil_months: f.oil_months.value? +f.oil_months.value : null,
      gear_km: f.gear_km.value? +f.gear_km.value : null,
      gear_months: f.gear_months.value? +f.gear_months.value : null,
    };
    if(!v.name || !(v.tankCapacity>0)) return alert('أكمل الحقول المطلوبة');
    FuelStore.saveVehicle(v); modVehicle.close(); reload();
  };

  $('#form-fuel').onsubmit = (e)=>{
    if(e.submitter?.value!=="confirm") return; e.preventDefault();
    const f = e.target;
    const rec = {
      id: f.id.value || undefined,
      vehicleId: f.vehicleId.value,
      date: f.date.value,
      odometer: +f.odometer.value,
      liters: +f.liters.value,
      pricePerLiter: f.pricePerLiter.value? +f.pricePerLiter.value : null,
      totalCost: f.totalCost.value? +f.totalCost.value : null,
      isFullTank: f.isFullTank.checked,
      notes: f.notes.value.trim()
    };
    const v = byVehicle(rec.vehicleId);
    if(!rec.vehicleId || !rec.date || !(rec.odometer>=0) || !(rec.liters>0)) return alert('تحقق من المدخلات');
    if(rec.isFullTank && v && rec.liters > (v.tankCapacity*1.1)) return alert('كمية غير منطقية مقارنة بسعة الخزان');
    // اشتقاق السعر/التكلفة إذا أُدخل أحدهما فقط
    if(rec.pricePerLiter && !rec.totalCost) rec.totalCost = +(rec.pricePerLiter*rec.liters).toFixed(2);
    if(!rec.pricePerLiter && rec.totalCost) rec.pricePerLiter = +(rec.totalCost/rec.liters).toFixed(2);

    // تحقق من ترتيب العدادات
    const lastOdo = latestOdometer(rec.vehicleId);
    if(lastOdo!=null && rec.odometer < lastOdo){
      if(!confirm('قراءة العداد أقل من آخر قراءة مسجلة. هل تريد المتابعة؟')) return;
    }

    FuelStore.saveFuelLog(rec); modFuel.close(); reload();
  };

  $('#form-service').onsubmit = (e)=>{
    if(e.submitter?.value!=="confirm") return; e.preventDefault();
    const f = e.target;
    const rec = {
      id: f.id.value || undefined,
      vehicleId: f.vehicleId.value,
      date: f.date.value,
      kind: f.kind.value,
      odometer: +f.odometer.value,
      intervalKm: f.intervalKm.value? +f.intervalKm.value : null,
      intervalMonths: f.intervalMonths.value? +f.intervalMonths.value : null,
      notes: f.notes.value.trim()
    };
    if(!rec.vehicleId || !rec.date || !rec.kind) return alert('تحقق من المدخلات');
    FuelStore.saveServiceLog(rec); modService.close(); reload();
  };

  // أزرار عامة
  $('#btn-add-vehicle').onclick = ()=> openVehicleModal();
  $('#btn-add-fuel').onclick = ()=> state.vehicles.length? openFuelModal(): alert('أضف مركبة أولاً');
  $('#btn-add-service').onclick = ()=> state.vehicles.length? openServiceModal(): alert('أضف مركبة أولاً');

  // تبديل التبويبات
  $$('.tab-btn').forEach(btn=>{
    btn.onclick = ()=>{
      $$('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $$('.tab-panel').forEach(p=>p.classList.remove('active'));
      $(`#tab-${tab}`).classList.add('active');
    };
  });

  // تحميل أولي
  function reload(){ load(); render(); }
  
  // Update time in header (iOS style)
  function updateTime(){
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: false });
    const timeEl = document.getElementById('current-time');
    if(timeEl) timeEl.textContent = timeStr;
  }
  updateTime();
  setInterval(updateTime, 1000);
  
  reload();
})();
