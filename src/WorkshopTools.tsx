import { useEffect, useState, type FormEvent } from 'react';
import type { Bike, WorkshopChemical, WorkshopTimer } from './types';
import { Localized, useTranslation } from './i18n';

type ToolTab = 'timers' | 'chemicals' | 'calculators' | 'references';

interface TimerPreset {
  key: string;
  title: string;
  detail: string;
  minMs: number;
  targetMs: number;
  maxMs: number;
  temperatureSensitive: boolean;
  warning?: string;
}

const hour = 60 * 60 * 1000;
const day = 24 * hour;

const timerPresets: TimerPreset[] = [
  {
    key: 'brunox-recoat',
    title: 'Brunox — második réteg',
    detail: 'A második réteg felvitelének időablaka: 1–6 óra.',
    minMs: hour,
    targetMs: 5 * hour,
    maxMs: 6 * hour,
    temperatureSensitive: true,
  },
  {
    key: 'brunox-cure',
    title: 'Brunox — teljes kikeményedés',
    detail: 'Tájékoztató jellegű, 24 órás figyelmeztető időzítő.',
    minMs: day,
    targetMs: day,
    maxMs: day,
    temperatureSensitive: true,
  },
  {
    key: 'citric-acid',
    title: 'Citromsavas tankkezelés',
    detail: 'Ellenőrzés 8–12 óra között; ne hagyd 24 órán túl.',
    minMs: 8 * hour,
    targetMs: 12 * hour,
    maxMs: day,
    temperatureSensitive: true,
  },
  {
    key: 'owatrol',
    title: 'Owatrol — száradás',
    detail: 'Tájékoztató száradási idő: 3–7 nap.',
    minMs: 3 * day,
    targetMs: 5 * day,
    maxMs: 7 * day,
    temperatureSensitive: true,
    warning: 'Az olajos rongyok öngyulladást okozhatnak. Kezeld és tárold őket a termék biztonsági adatlapja szerint.',
  },
  {
    key: 'brantho',
    title: 'Brantho / rücsi — száradás',
    detail: 'Tájékoztató száradási idő: 24 óra.',
    minMs: day,
    targetMs: day,
    maxMs: day,
    temperatureSensitive: true,
  },
];

const wireMap: Record<string, { color: string; function: string }> = {
  A: { color: 'Fekete', function: 'Testelés (−), gyújtótekercsek és alap tápágak.' },
  B: { color: 'Fehér', function: 'Tompított fényszóró és kapcsolóáramkör.' },
  C: { color: 'Kék', function: 'Távolsági fényszóró és kék visszajelző.' },
  D: { color: 'Zöld', function: 'Dinamó D+ / töltésjelző és gerjesztési kör.' },
  E: { color: 'Sárga', function: 'Irányjelző, kürt és helyzetjelző áramkör.' },
  F: { color: 'Piros', function: 'Akkumulátor (+) fő tápág, 15 A biztosítékon át.' },
  G: { color: 'Szürke', function: 'Hátsó helyzetjelző és műszerfal-világítás.' },
  H: { color: 'Barna', function: 'Féklámpa és hátsó fékkapcsoló köre.' },
  I: { color: 'Fehér-fekete', function: 'Megszakító / kondenzátor → gyújtótrafók jelvezetéke.' },
};

const bearingCatalog = [
  { code: '6305 C36', size: '25 × 62 × 15 mm', location: 'Főtengely, bal + jobb oldal', quantity: '2 db' },
  { code: '6306 C36', size: '30 × 72 × 19 mm', location: 'Főtengely közepe', quantity: '1 db' },
  { code: '6303', size: '17 × 47 × 13 mm', location: 'Váltó', quantity: '1 db' },
  { code: '3205', size: '25 × 52 × 20,6 mm', location: 'Váltó, duplasoros', quantity: '1 db' },
  { code: '6302', size: '15 × 42 × 13 mm', location: 'Első + hátsó kerékagy', quantity: '4 db' },
  { code: '6205', size: '25 × 52 × 15 mm', location: 'Hátsó lánckerékagy', quantity: '1 db' },
  { code: 'Szimering', size: '25 × 62 × 8 mm', location: 'Főtengely', quantity: '2 db' },
  { code: 'Szimering', size: '30 × 52 × 12 mm', location: 'Váltó / kihajtótengely', quantity: '1 db' },
  { code: 'Szimering', size: '8 × 16 × 7 mm', location: 'Kilométeróra-meghajtás', quantity: '1 db' },
];

function formatDuration(milliseconds: number, language: 'hu' | 'de') {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const units = language === 'de'
    ? { day: 'Tage', hour: 'Std.', minute: 'Min.' }
    : { day: 'nap', hour: 'óra', minute: 'perc' };
  if (days) return `${days} ${units.day} ${hours} ${units.hour}`;
  if (hours) return `${hours} ${units.hour} ${minutes} ${units.minute}`;
  return `${minutes} ${units.minute}`;
}

function temperatureFactor(temperature: number) {
  if (temperature < 15) return 1.5;
  if (temperature > 25 && temperature <= 35) return 0.9;
  return 1;
}

interface WorkshopToolsProps {
  bikes: Bike[];
  workshopTempC: number;
  timers: WorkshopTimer[];
  chemicals: WorkshopChemical[];
  onTemperatureChange: (temperature: number) => void;
  onStartTimer: (timer: WorkshopTimer) => void;
  onDeleteTimer: (timerId: string) => void;
  onAddChemical: (chemical: WorkshopChemical) => void;
  onRemoveChemical: (chemicalId: string) => void;
  onAddShoppingItem: (name: string, quantity: string, bikeId: string | null) => void;
}

export default function WorkshopTools({
  bikes,
  workshopTempC,
  timers,
  chemicals,
  onTemperatureChange,
  onStartTimer,
  onDeleteTimer,
  onAddChemical,
  onRemoveChemical,
  onAddShoppingItem,
}: WorkshopToolsProps) {
  const { language, t } = useTranslation();
  const [tab, setTab] = useState<ToolTab>('timers');
  const [now, setNow] = useState(Date.now());
  const [twoStrokeLiters, setTwoStrokeLiters] = useState('16.5');
  const [twoStrokeOilMl, setTwoStrokeOilMl] = useState('200');
  const [twoStrokeMode, setTwoStrokeMode] = useState<'fuel-to-oil' | 'oil-to-fuel'>('fuel-to-oil');
  const [twoStrokeRatio, setTwoStrokeRatio] = useState('40');
  const [forkOilPerLeg, setForkOilPerLeg] = useState('140');
  const [forkBlend, setForkBlend] = useState<'summer' | 'pure'>('summer');
  const [tankLiters, setTankLiters] = useState('16.5');
  const [acidPercent, setAcidPercent] = useState('6');
  const [selectedBikeId, setSelectedBikeId] = useState(bikes[0]?.id ?? '');
  const [wireCode, setWireCode] = useState('A');
  const [jikovModel, setJikovModel] = useState('2802');

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  function startTimer(preset: TimerPreset) {
    onStartTimer({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      bikeId: selectedBikeId || null,
      presetKey: preset.key,
      startedAt: Date.now(),
      tempAtStart: workshopTempC,
    });
  }

  function addChemical(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get('name') ?? '').trim();
    const purpose = String(formData.get('purpose') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim();
    const timerInput = String(formData.get('timerMinutes') ?? '').trim();
    const timerMinutes = timerInput ? Number(timerInput) : undefined;
    if (!name || !purpose || (timerMinutes !== undefined && (!Number.isInteger(timerMinutes) || timerMinutes < 1))) return;
    onAddChemical({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      purpose,
      notes,
      ...(timerMinutes ? { timerMinutes } : {}),
    });
    form.reset();
  }

  function startChemicalTimer(chemical: WorkshopChemical) {
    if (!chemical.timerMinutes) return;
    onStartTimer({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      bikeId: selectedBikeId || null,
      presetKey: `chemical:${chemical.id}`,
      startedAt: Date.now(),
      tempAtStart: workshopTempC,
      customTitle: chemical.name,
      customDurationMinutes: chemical.timerMinutes,
    });
    setTab('timers');
  }

  const tabs: { id: ToolTab; label: string }[] = [
    { id: 'timers', label: 'Száradási időzítők' },
    { id: 'chemicals', label: `${t('Vegyszerek')} (${chemicals.length})` },
    { id: 'calculators', label: 'Kalkulátorok' },
    { id: 'references', label: 'Gyorsreferencia' },
  ];
  const ratio = Number(twoStrokeRatio);
  const fuelLiters = Number(twoStrokeLiters);
  const oilMl = Number(twoStrokeOilMl);
  const forkAmount = Number(forkOilPerLeg);
  const forkMainOil = forkBlend === 'summer' ? Math.round(forkAmount * 100 / 140) : forkAmount;
  const forkSummerOil = forkBlend === 'summer' ? forkAmount - forkMainOil : 0;
  const selectedWire = wireMap[wireCode];

  return (
    <Localized>
    <section className="workshop-tools panel">
      <header className="panel-heading workshop-tools-heading">
        <div>
          <p className="eyebrow">MŰHELY SEGÉDESZKÖZÖK</p>
          <h2>Műhely eszközök</h2>
        </div>
      </header>
      <nav className="tool-tabs" aria-label="Műhely eszközök">
        {tabs.map((item) => (
          <button key={item.id} type="button" className={tab === item.id ? 'tool-tab active' : 'tool-tab'} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'timers' && (
        <section className="tool-section">
          <div className="tool-callout">
            <strong>Időzítők emlékeztetőként</strong>
            <p>A tényleges kötési és száradási időt mindig a termék címkéje, adatlapja és a gyártó hőmérsékleti előírása határozza meg.</p>
          </div>
          <div className="temperature-control">
            <label htmlFor="workshop-temperature">Műhely hőmérséklete: <strong>{workshopTempC} °C</strong></label>
            <input id="workshop-temperature" type="range" min="-5" max="40" step="1" value={workshopTempC} onChange={(event) => onTemperatureChange(Number(event.target.value))} />
            {workshopTempC < 5
              ? <small className="temperature-warning">5 °C alatt a hőmérséklet-érzékeny időzítők indítása le van tiltva.</small>
              : <small>{workshopTempC < 15 ? 'Hidegebb műhelynél a becsült idő hosszabb lehet.' : workshopTempC > 35 ? 'Magas hőmérséklet: kövesd a termék adatlapját.' : 'A hőmérséklet csak tájékoztató becslés.'}</small>}
          </div>
          <label className="tool-bike-select">
            <span>Kapcsolódó motorkerékpár</span>
            <select value={selectedBikeId} onChange={(event) => setSelectedBikeId(event.target.value)}>
              <option value="">Közös műhelymunka</option>
              {bikes.map((bike) => <option key={bike.id} value={bike.id}>{bike.name}</option>)}
            </select>
          </label>
          <div className="timer-preset-grid">
            {timerPresets.map((preset) => (
              <article className="timer-preset" key={preset.key}>
                <h3>{preset.title}</h3>
                <p>{preset.detail}</p>
                {preset.warning && <p className="timer-safety-warning">{preset.warning}</p>}
                <button className="button button-secondary" type="button" disabled={preset.temperatureSensitive && workshopTempC < 5} onClick={() => startTimer(preset)}>Időzítő indítása</button>
              </article>
            ))}
          </div>
          <div className="active-timers">
            <div className="tool-subheading"><h3>Futó időzítők</h3><span>{timers.length}</span></div>
            {timers.length ? timers.map((timer) => {
              const preset = timerPresets.find((candidate) => candidate.key === timer.presetKey);
              const customDurationMs = timer.customDurationMinutes ? timer.customDurationMinutes * 60_000 : 0;
              const title = preset?.title ?? timer.customTitle;
              if (!title || (!preset && !customDurationMs)) return null;
              const factor = preset ? temperatureFactor(workshopTempC) : 1;
              const elapsed = now - timer.startedAt;
              const minMs = preset ? preset.minMs * factor : customDurationMs;
              const targetMs = preset ? preset.targetMs * factor : customDurationMs;
              const maxMs = preset ? preset.maxMs * factor : customDurationMs;
              const progress = Math.min(100, Math.round((elapsed / maxMs) * 100));
              const status = elapsed >= maxMs
                ? (language === 'de' ? 'Abgelaufen — prüfen' : 'Lejárt — ellenőrizd')
                : elapsed >= minMs
                  ? (language === 'de' ? 'Prüfung fällig' : 'Ellenőrzés esedékes')
                  : `${language === 'de' ? 'Erinnerung in:' : 'Hátra a jelzésig:'} ${formatDuration(targetMs - elapsed, language)}`;
              return (
                <article className={`active-timer ${elapsed >= maxMs ? 'timer-expired' : ''}`} key={timer.id}>
                  <div className="active-timer-heading">
                    <div><strong>{title}</strong><small>{bikes.find((bike) => bike.id === timer.bikeId)?.name ?? 'Közös műhely'} · {language === 'de' ? 'aktuell' : 'jelenleg'} {workshopTempC} °C</small></div>
                    <button className="timer-cancel-button" type="button" onClick={() => onDeleteTimer(timer.id)}>Időzítő leállítása</button>
                  </div>
                  <div className="timer-progress"><span style={{ width: `${progress}%` }} /></div>
                  <div className="active-timer-status"><span>{status}</span><span>{formatDuration(elapsed, language)} {language === 'de' ? 'vergangen' : 'telt el'}</span></div>
                  {preset?.key === 'citric-acid' && elapsed >= maxMs && <p className="timer-safety-warning">A 24 órás felső határ eltelt. Azonnal ellenőrizd a kezelést és a tartály állapotát.</p>}
                  {preset?.key === 'brunox-recoat' && elapsed >= targetMs && <p className="timer-safety-warning">Közeledik a második réteg 6 órás határa; ellenőrizd a termék adatlapját.</p>}
                </article>
              );
            }) : <p className="tool-empty">Nincs futó időzítő. Válassz fent egy emlékeztetőt.</p>}
          </div>
        </section>
      )}

      {tab === 'chemicals' && (
        <section className="tool-section chemical-section">
          <div className="tool-callout">
            <strong>Saját vegyszerek és kezelőanyagok</strong>
            <p>A terméknév, használat és megadott idő csak saját emlékeztető. Mindig a címke és a gyártói adatlap az irányadó.</p>
          </div>
          <form className="chemical-form" onSubmit={addChemical}>
            <label>Név<input name="name" maxLength={100} required placeholder="Pl. rozsdaátalakító" /></label>
            <label>Felhasználás<input name="purpose" maxLength={160} required placeholder="Mire használod?" /></label>
            <label>Megjegyzés<textarea name="notes" maxLength={500} placeholder="Saját megjegyzések, biztonsági tudnivalók…" /></label>
            <label>Időzítő (perc, opcionális)<input name="timerMinutes" type="number" min="1" max="525600" step="1" placeholder="Pl. 90" /></label>
            <button className="button button-primary" type="submit">＋ Vegyszer hozzáadása</button>
          </form>
          <div className="chemical-list">
            <div className="tool-subheading"><h3>Mentett vegyszerek</h3><span>{chemicals.length}</span></div>
            {chemicals.length ? chemicals.map((chemical) => (
              <article className="chemical-card" key={chemical.id}>
                <div className="chemical-card-heading">
                  <div><strong>{chemical.name}</strong><small>{chemical.purpose}{chemical.sourceFile ? ` · AI-forrás: ${chemical.sourceFile}` : ''}</small></div>
                  <button className="chemical-remove-button" type="button" onClick={() => onRemoveChemical(chemical.id)} aria-label={`${t('Vegyszer törlése')}: ${chemical.name}`}>Törlés</button>
                </div>
                {chemical.notes && <p>{chemical.notes}</p>}
                {chemical.timerMinutes
                  ? <button className="button button-secondary" type="button" onClick={() => startChemicalTimer(chemical)}>Időzítő indítása · {formatDuration(chemical.timerMinutes * 60_000, language)}</button>
                  : <small className="chemical-no-timer">Ehhez nincs megadva időzítő.</small>}
              </article>
            )) : <p className="tool-empty">Még nincs vegyszer. Adj hozzá egyet fent, vagy importáld egy AI-útmutató feldolgozásakor.</p>}
          </div>
        </section>
      )}

      {tab === 'calculators' && (
        <section className="tool-section calculator-grid">
          <article className="calculator-card">
            <h3>Kétütemű keverék</h3>
            <p>Olajmennyiség a megadott benzinhez.</p>
            <label>Számítás iránya<select value={twoStrokeMode} onChange={(event) => setTwoStrokeMode(event.target.value as 'fuel-to-oil' | 'oil-to-fuel')}><option value="fuel-to-oil">Benzinből olaj</option><option value="oil-to-fuel">Olajból benzin</option></select></label>
            <label>Keverési arány<select value={twoStrokeRatio} onChange={(event) => setTwoStrokeRatio(event.target.value)}><option value="33">1:33</option><option value="40">1:40</option><option value="50">1:50</option></select></label>
            {twoStrokeMode === 'fuel-to-oil'
              ? <label>Benzin (liter)<input type="number" min="0" step="0.5" value={twoStrokeLiters} onChange={(event) => setTwoStrokeLiters(event.target.value)} /></label>
              : <label>Olaj (ml)<input type="number" min="0" step="10" value={twoStrokeOilMl} onChange={(event) => setTwoStrokeOilMl(event.target.value)} /></label>}
            <output>{twoStrokeMode === 'fuel-to-oil'
              ? fuelLiters > 0
                ? `${(fuelLiters * 1000 / ratio).toFixed(0)} ml ${language === 'de' ? 'Öl' : 'olaj'}`
                : t('Adj meg egy érvényes mennyiséget.')
              : oilMl > 0
                ? `${(oilMl * ratio / 1000).toFixed(2)} l ${language === 'de' ? 'Benzin' : 'benzin'}`
                : t('Adj meg egy érvényes mennyiséget.')}</output>
          </article>
          <article className="calculator-card">
            <h3>Villaolaj</h3>
            <p>Számítás villaszáranként és a két szár összes mennyiségére.</p>
            <label>Keverék<select value={forkBlend} onChange={(event) => setForkBlend(event.target.value as 'summer' | 'pure')}><option value="summer">Nyári keverék</option><option value="pure">Tiszta villaolaj</option></select></label>
            <label>Teljes mennyiség villaszáranként (cm³)<input type="number" min="50" max="400" step="5" value={forkOilPerLeg} onChange={(event) => setForkOilPerLeg(event.target.value)} /></label>
            <output>{forkAmount >= 50
              ? forkBlend === 'summer'
                ? language === 'de'
                  ? `${forkMainOil * 2} cm³ Gabelöl + ${forkSummerOil * 2} cm³ SAE 40/50 insgesamt`
                  : `${forkMainOil * 2} cm³ villaolaj + ${forkSummerOil * 2} cm³ SAE 40/50 összesen`
                : language === 'de'
                  ? `${forkAmount * 2} cm³ reines Gabelöl insgesamt`
                  : `${forkAmount * 2} cm³ tiszta villaolaj összesen`
              : language === 'de'
                ? 'Gib mindestens 50 cm³ pro Gabelholm ein.'
                : 'Adj meg legalább 50 cm³-t villaszáranként.'}</output>
            {forkBlend === 'summer' && forkAmount >= 50 && <small>{language === 'de' ? 'Pro Holm:' : 'Száronként:'} {forkMainOil} cm³ {language === 'de' ? 'Gabelöl' : 'villaolaj'} + {forkSummerOil} cm³ SAE 40/50.</small>}
            <small>{t('A megfelelő viszkozitást és mennyiséget ellenőrizd a szervizkönyvben.')}</small>
          </article>
          <article className="calculator-card">
            <h3>Citromsav-recept</h3>
            <p>Számított por-mennyiség a tartály űrtartalmához.</p>
            <label>Tartály (liter)<input type="number" min="0" step="0.1" value={tankLiters} onChange={(event) => setTankLiters(event.target.value)} /></label>
            <label>Koncentráció<select value={acidPercent} onChange={(event) => setAcidPercent(event.target.value)}><option value="5">5%</option><option value="6">6%</option><option value="8">8%</option><option value="10">10%</option></select></label>
            <output>{Number(tankLiters) > 0
              ? `${(Number(tankLiters) * Number(acidPercent) * 10).toFixed(0)} g (${(Number(tankLiters) * Number(acidPercent) / 100).toFixed(2)} kg)`
              : t('Adj meg egy érvényes mennyiséget.')}</output>
            <small>{t('Semlegesítéshez a régi útmutató 1–2 l vizet és 2–3 evőkanál szódabikarbónát említ. Mindig ellenőrizd a saját eljárásodat és a biztonsági adatlapot.')}</small>
          </article>
        </section>
      )}

      {tab === 'references' && (
        <section className="tool-section reference-grid">
          <article className="reference-card">
            <p className="eyebrow">TANKTISZTÍTÁS</p>
            <h3>Citromsavas kezelés</h3>
            <ul><li>Útmutató szerinti koncentráció: 5–10%</li><li>Meleg oldat: körülbelül 40–60 °C</li><li>Ellenőrzés 8–12 óra után, legfeljebb 24 óra</li><li>Trisós zsírtalanítás: 1–2 óra</li></ul>
            <p className="reference-caution">Ezek a prototípus tájékoztató értékei, nem helyettesítik az adott anyag gyártói utasítását.</p>
          </article>
          <article className="reference-card">
            <p className="eyebrow">JAWA 6 V / JIKOV</p>
            <h3>Gyors ellenőrző értékek</h3>
            <ul><li>Nyugalmi feszültség: 6,2 V</li><li>Emelt fordulaton: 7,2 V</li><li>35 W lámpaterheléssel: 6,9 V</li><li>Generátorkefe: 10 mm</li><li>Jikov 2802: főfúvóka 115, alapjárati 55</li><li>Jikov 2801: főfúvóka 92, alapjárati 55</li></ul>
            <p className="reference-caution">Típusonként és alkatrészenként eltérhet. Mérés előtt az adott motorkerékpár kapcsolási rajzát és kézikönyvét használd.</p>
            <label className="reference-selector">Karburátor típusa<select value={jikovModel} onChange={(event) => setJikovModel(event.target.value)}><option value="2802">Jikov 2802</option><option value="2801">Jikov 2801</option></select></label>
            <p className="reference-selected-value">{jikovModel === '2802' ? 'Főfúvóka 115 · alapjárati fúvóka 55' : 'Főfúvóka 92 · alapjárati fúvóka 55'}</p>
            <label className="reference-selector">Vezeték jelölése<select value={wireCode} onChange={(event) => setWireCode(event.target.value)}>{Object.keys(wireMap).map((code) => <option key={code}>{code}</option>)}</select></label>
            <p className="reference-selected-value">{wireCode} — {selectedWire.color}: {selectedWire.function}</p>
          </article>
          <article className="reference-card">
            <p className="eyebrow">FELÚJÍTÁSI EMLÉKEZTETŐ</p>
            <h3>Száradási idők a prototípusból</h3>
            <ul><li>Brunox második réteg: 1–6 óra</li><li>Owatrol: 3–7 nap</li><li>Brantho / rücsi: körülbelül 24 óra</li><li>Citromsavas tankkezelés: 8–12 óránál ellenőrzés</li></ul>
            <p className="reference-caution">A hőmérséklet, rétegvastagság és termékösszetétel módosíthatja az időt.</p>
          </article>
          <article className="reference-card bearing-reference">
            <p className="eyebrow">JAWA 350 · PROTOTÍPUS ADATAI</p>
            <h3>Csapágyak és szimeringek</h3>
            <p className="reference-caution">Ellenőrizd a motor pontos kiviteléhez tartozó szerelési adatokat a rendelés előtt.</p>
            <div className="bearing-table-wrap">
              <table className="bearing-table">
                <thead><tr><th>Jelölés</th><th>Méret</th><th>Hely</th><th>Db</th><th /></tr></thead>
                <tbody>
                  {bearingCatalog.map((item) => (
                    <tr key={`${item.code}-${item.location}`}>
                      <td>{item.code}</td><td>{item.size}</td><td>{item.location}</td><td>{item.quantity}</td>
                      <td><button className="catalog-add-button" type="button" onClick={() => onAddShoppingItem(`${item.code} — ${item.location}`, item.quantity, selectedBikeId || null)}>＋</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}
    </section>
    </Localized>
  );
}
