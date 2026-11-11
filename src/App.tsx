import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import AiGuideStudio, { toTasks } from './AiGuideStudio';
import WorkshopTools from './WorkshopTools';
import { DEFAULT_PLANNING_PERIODS, initialGarage, LEGACY_STORAGE_KEY, STORAGE_KEY } from './data';
import { deleteBikePhoto, getBikePhoto, makeStoredPhoto, replaceAllBikePhotos, saveBikePhoto } from './photoStorage';
import { LanguageContext, Localized, translate, useTranslation, type Language } from './i18n';
import type { AiGuide, Bike, BikePhoto, BikeSpecification, BikeStatus, BikeTask, GarageData, ShoppingCategory, ShoppingItem, ShoppingStatus, WorkshopChemical, WorkshopTimer } from './types';

type View = 'garage' | 'bike' | 'tasks' | 'plan' | 'shopping' | 'tools' | 'guides';
type TaskFilter = 'open' | 'all';
type PlanningPeriodFilter = string;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const statuses: BikeStatus[] = ['Folyamatban', 'Tervezett', 'Kész', 'Áll'];
const shoppingCategories: ShoppingCategory[] = ['Műhelyanyag', 'Motoralkatrész'];
const shoppingStatuses: ShoppingStatus[] = ['Beszerzendő', 'Megrendelve', 'Megérkezett'];
const NOTION_WORKER_URL_KEY = 'muhelygarazs_notion_worker_url';
const NOTION_SYNC_TOKEN_KEY = 'muhelygarazs_notion_sync_token';
const specificationFields = [
  { key: 'engineCode', label: 'Motorkód' },
  { key: 'frameNumber', label: 'Alvázszám / vázszám' },
  { key: 'engineNumber', label: 'Motorszám' },
  { key: 'displacementCc', label: 'Hengerűrtartalom (cm³)' },
  { key: 'power', label: 'Teljesítmény' },
  { key: 'transmission', label: 'Sebességváltó' },
  { key: 'fuel', label: 'Üzemanyag / keverék' },
  { key: 'ignition', label: 'Gyújtás' },
] as const;

type SpecificationKey = (typeof specificationFields)[number]['key'];

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function compressPhoto(file: File): Promise<Blob> {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A képet nem sikerült előkészíteni a mentéshez.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    if (!blob) throw new Error('A képet nem sikerült JPEG formátumba alakítani.');
    return blob;
  } finally {
    image.close();
  }
}

function photoDataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('A biztonsági mentés egyik fotója hibás vagy nem támogatott formátumú.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('A fotót nem sikerült a biztonsági mentéshez beolvasni.'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('A fotó biztonsági mentési formátuma érvénytelen.'));
    reader.readAsDataURL(blob);
  });
}

function withoutPhotoData(garage: GarageData): GarageData {
  return {
    ...garage,
    bikes: garage.bikes.map((bike) => ({
      ...bike,
      photos: (bike.photos ?? []).map(({ dataUrl: _dataUrl, ...photo }) => photo),
    })),
  };
}

function isBikeStatus(value: unknown): value is BikeStatus {
  return typeof value === 'string' && statuses.some((status) => status === value);
}

function isBikeTask(value: unknown): value is BikeTask {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.category === 'string' &&
    typeof task.done === 'boolean' &&
    (task.period === undefined || typeof task.period === 'string') &&
    (task.season === undefined || typeof task.season === 'string') &&
    (task.guideId === undefined || typeof task.guideId === 'string') &&
    (task.guidePointId === undefined || typeof task.guidePointId === 'string')
  );
}

function isShoppingItem(value: unknown): value is ShoppingItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.quantity === 'string' &&
    shoppingCategories.includes(value.category as ShoppingCategory) &&
    (value.bikeId === null || typeof value.bikeId === 'string') &&
    (value.status === undefined || shoppingStatuses.includes(value.status as ShoppingStatus)) &&
    (value.bought === undefined || typeof value.bought === 'boolean')
  );
}

function isWorkshopTimer(value: unknown): value is WorkshopTimer {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    (value.bikeId === null || typeof value.bikeId === 'string') &&
    typeof value.presetKey === 'string' &&
    typeof value.startedAt === 'number' &&
    typeof value.tempAtStart === 'number' &&
    (value.customTitle === undefined || typeof value.customTitle === 'string') &&
    (value.customDurationMinutes === undefined || typeof value.customDurationMinutes === 'number')
  );
}

function isWorkshopChemical(value: unknown): value is WorkshopChemical {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.purpose === 'string' &&
    typeof value.notes === 'string' &&
    (value.timerMinutes === undefined || (typeof value.timerMinutes === 'number' && value.timerMinutes > 0)) &&
    (value.sourceFile === undefined || typeof value.sourceFile === 'string')
  );
}

function isAiGuide(value: unknown): value is AiGuide {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.subtitle === 'string' &&
    typeof value.sourceFile === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.steps) &&
    value.steps.every((step) =>
      isRecord(step) &&
      typeof step.id === 'string' &&
      typeof step.title === 'string' &&
      typeof step.summary === 'string' &&
      typeof step.category === 'string' &&
      Array.isArray(step.points) &&
      step.points.every((point) =>
        isRecord(point) &&
        typeof point.id === 'string' &&
        typeof point.text === 'string' &&
        typeof point.isWarning === 'boolean' &&
        typeof point.done === 'boolean',
      ),
    )
  );
}

function isBikeSpecification(value: unknown): value is BikeSpecification {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.value === 'string';
}

function isBikePhoto(value: unknown): value is BikePhoto {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    (value.dataUrl === undefined || (typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:image/'))) &&
    (value.date === undefined || (typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date))) &&
    typeof value.tag === 'string' &&
    typeof value.comment === 'string' &&
    typeof value.createdAt === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBike(value: unknown): value is Bike {
  if (typeof value !== 'object' || value === null) return false;
  const bike = value as Record<string, unknown>;
  return (
    typeof bike.id === 'string' &&
    typeof bike.name === 'string' &&
    typeof bike.year === 'number' &&
    isBikeStatus(bike.status) &&
    typeof bike.frameNumber === 'string' &&
    typeof bike.engineNumber === 'string' &&
    (bike.engineCode === undefined || typeof bike.engineCode === 'string') &&
    (bike.displacementCc === undefined || typeof bike.displacementCc === 'string') &&
    (bike.power === undefined || typeof bike.power === 'string') &&
    (bike.transmission === undefined || typeof bike.transmission === 'string') &&
    (bike.fuel === undefined || typeof bike.fuel === 'string') &&
    (bike.ignition === undefined || typeof bike.ignition === 'string') &&
    (bike.specifications === undefined || (Array.isArray(bike.specifications) && bike.specifications.every(isBikeSpecification))) &&
    (bike.photos === undefined || (Array.isArray(bike.photos) && bike.photos.every(isBikePhoto))) &&
    Array.isArray(bike.tasks) &&
    bike.tasks.every(isBikeTask) &&
    (bike.guides === undefined || (Array.isArray(bike.guides) && bike.guides.every(isAiGuide)))
  );
}

function isGarageData(value: unknown): value is GarageData {
  if (typeof value !== 'object' || value === null) return false;
  const garage = value as Record<string, unknown>;
  return (
    Array.isArray(garage.bikes) &&
    garage.bikes.every(isBike) &&
    typeof garage.activeBikeId === 'string' &&
    (garage.shoppingItems === undefined ||
      (Array.isArray(garage.shoppingItems) && garage.shoppingItems.every(isShoppingItem))) &&
    (garage.planningPeriods === undefined ||
      (Array.isArray(garage.planningPeriods) && garage.planningPeriods.every((period) => typeof period === 'string'))) &&
    (garage.workshopTempC === undefined || typeof garage.workshopTempC === 'number') &&
    (garage.workshopTimers === undefined ||
      (Array.isArray(garage.workshopTimers) && garage.workshopTimers.every(isWorkshopTimer))) &&
    (garage.workshopChemicals === undefined ||
      (Array.isArray(garage.workshopChemicals) && garage.workshopChemicals.every(isWorkshopChemical)))
  );
}

function loadGarage(): { data: GarageData; warning: string | null } {
  let migrationWarning: string | null = null;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.error('A régi böngészőmentés nem törölhető:', error);
    migrationWarning = 'A régi böngészőmentést nem sikerült törölni. Kérjük, töröld az alkalmazás webhelyadatait a böngésző beállításaiban.';
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { data: initialGarage, warning: migrationWarning };

    const parsed: unknown = JSON.parse(saved);
    if (!isGarageData(parsed)) throw new Error('Érvénytelen garázs-adat');
    const data = parsed;
    data.bikes = data.bikes.map((bike) => ({
      ...bike,
      guides: bike.guides ?? [],
      specifications: bike.specifications ?? [],
      photos: (bike.photos ?? []).map((photo) => ({
        ...photo,
        date: photo.date ?? photo.createdAt.slice(0, 10),
      })),
      engineCode: bike.engineCode ?? '',
      displacementCc: bike.displacementCc ?? '',
      power: bike.power ?? '',
      transmission: bike.transmission ?? '',
      fuel: bike.fuel ?? '',
      ignition: bike.ignition ?? '',
      tasks: bike.tasks.map((task) => {
        const { season, ...rest } = task;
        return { ...rest, period: task.period ?? season ?? 'Bármikor' };
      }),
    }));
    data.shoppingItems ??= [];
    data.shoppingItems = data.shoppingItems.map((item) => {
      const { bought, ...rest } = item;
      return { ...rest, status: item.status ?? (bought ? 'Megérkezett' : 'Beszerzendő') };
    });
    data.planningPeriods ??= [...DEFAULT_PLANNING_PERIODS];
    data.planningPeriods = [...new Set(data.planningPeriods.length ? data.planningPeriods : DEFAULT_PLANNING_PERIODS)];
    data.workshopTempC ??= 18;
    data.workshopTimers ??= [];
    data.workshopChemicals ??= [];
    if (!data.bikes.some((bike) => bike.id === data.activeBikeId)) {
      data.activeBikeId = data.bikes[0]?.id ?? '';
    }
    return { data, warning: migrationWarning };
  } catch (error) {
    console.error('A mentett garázs-adatokat nem sikerült betölteni:', error);
    return {
      data: initialGarage,
      warning: migrationWarning ?? 'A mentett adatok nem olvashatók. A mintaadatokkal indult az alkalmazás.',
    };
  }
}

function App() {
  const [loaded] = useState(loadGarage);
  const [garage, setGarage] = useState<GarageData>(loaded.data);
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem('muhelygarazs_language') === 'de' ? 'de' : 'hu';
    } catch (error) {
      console.error('A nyelvi beállítást nem sikerült beolvasni:', error);
      return 'hu';
    }
  });
  const [ownerName, setOwnerName] = useState(() => {
    try {
      return localStorage.getItem('muhelygarazs_owner_name') ?? '';
    } catch (error) {
      console.error('A megjelenített nevet nem sikerült beolvasni:', error);
      return '';
    }
  });
  const [notionWorkerUrl, setNotionWorkerUrl] = useState(() => {
    try {
      return localStorage.getItem(NOTION_WORKER_URL_KEY) ?? '';
    } catch (error) {
      console.error('A Notion Worker címét nem sikerült beolvasni:', error);
      return '';
    }
  });
  const [notionSyncToken, setNotionSyncToken] = useState(() => {
    try {
      return localStorage.getItem(NOTION_SYNC_TOKEN_KEY) ?? '';
    } catch (error) {
      console.error('A Notion szinkronizálási kulcsát nem sikerült beolvasni:', error);
      return '';
    }
  });
  const [notionSyncing, setNotionSyncing] = useState(false);
  const [notionSyncMessage, setNotionSyncMessage] = useState<string | null>(null);
  const t = (text: string) => translate(language, text);
  const [photosReady, setPhotosReady] = useState(false);
  const [photoMigrationFailed, setPhotoMigrationFailed] = useState(false);
  const [activeView, setActiveView] = useState<View>('garage');
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('open');
  const [periodFilter, setPeriodFilter] = useState<PlanningPeriodFilter>('Összes');
  const [planBikeFilter, setPlanBikeFilter] = useState('all');
  const [shoppingFilter, setShoppingFilter] = useState<TaskFilter>('open');
  const [shoppingScope, setShoppingScope] = useState('all');
  const [garageListCollapsed, setGarageListCollapsed] = useState(true);
  const [mobileProjectCollapsed, setMobileProjectCollapsed] = useState(() =>
    window.matchMedia('(max-width: 560px) and (orientation: portrait)').matches,
  );
  const [showBikeForm, setShowBikeForm] = useState(false);
  const [showBackupTools, setShowBackupTools] = useState(false);
  const [newBikeName, setNewBikeName] = useState('');
  const [newBikeYear, setNewBikeYear] = useState(String(new Date().getFullYear()));
  const backupInputRef = useRef<HTMLInputElement>(null);
  const mainNavRef = useRef<HTMLElement>(null);
  const [storageMessage, setStorageMessage] = useState(loaded.warning);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isStandalone, setIsStandalone] = useState(
    window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && navigator.standalone === true),
  );

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem('muhelygarazs_language', language);
    } catch (error) {
      console.error('A nyelvi beállítást nem sikerült elmenteni:', error);
      setStorageMessage('A nyelvi beállítást nem sikerült elmenteni ezen az eszközön.');
    }
  }, [language]);

  useEffect(() => {
    try {
      const name = ownerName.trim();
      if (name) {
        localStorage.setItem('muhelygarazs_owner_name', name);
      } else {
        localStorage.removeItem('muhelygarazs_owner_name');
      }
    } catch (error) {
      console.error('A megjelenített nevet nem sikerült elmenteni:', error);
      setStorageMessage('A megjelenített nevet nem sikerült elmenteni ezen az eszközön.');
    }
  }, [ownerName]);

  useEffect(() => {
    try {
      if (notionWorkerUrl.trim()) {
        localStorage.setItem(NOTION_WORKER_URL_KEY, notionWorkerUrl.trim());
      } else {
        localStorage.removeItem(NOTION_WORKER_URL_KEY);
      }
      if (notionSyncToken.trim()) {
        localStorage.setItem(NOTION_SYNC_TOKEN_KEY, notionSyncToken.trim());
      } else {
        localStorage.removeItem(NOTION_SYNC_TOKEN_KEY);
      }
    } catch (error) {
      console.error('A Notion szinkronizálási beállításait nem sikerült elmenteni:', error);
      setStorageMessage('A Notion beállításait nem sikerült ezen az eszközön elmenteni.');
    }
  }, [notionWorkerUrl, notionSyncToken]);

  useEffect(() => {
    let cancelled = false;
    async function migrateLegacyPhotos() {
      try {
        const oldPhotos = garage.bikes.flatMap((bike) =>
          (bike.photos ?? [])
            .filter((photo): photo is BikePhoto & { dataUrl: string } => Boolean(photo.dataUrl))
            .map((photo) => ({ bikeId: bike.id, photo })),
        );
        for (const { bikeId, photo } of oldPhotos) {
          await saveBikePhoto(bikeId, photo.id, photoDataUrlToBlob(photo.dataUrl));
        }
        if (cancelled) return;
        if (oldPhotos.length) {
          setGarage((current) => withoutPhotoData(current));
          setStorageMessage('A korábban mentett fotók átkerültek a helyi képtárba.');
        }
        setPhotosReady(true);
      } catch (error) {
        console.error('A korábbi fotókat nem sikerült biztonságosan átköltöztetni:', error);
        if (!cancelled) {
          setStorageMessage('A korábbi fotók átköltöztetése nem sikerült. A régi mentés megmaradt; ellenőrizd a böngésző tárhelyét, majd töltsd újra az alkalmazást.');
          setPhotoMigrationFailed(true);
          setPhotosReady(true);
        }
      }
    }
    void migrateLegacyPhotos();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      if (!photosReady) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(photoMigrationFailed ? garage : withoutPhotoData(garage)));
    } catch (error) {
      console.error('A garázs mentése nem sikerült:', error);
      setStorageMessage('A mentés nem sikerült. Ellenőrizd a böngésző tárhelyét.');
    }
  }, [garage, photosReady, photoMigrationFailed]);

  useEffect(() => {
    const nav = mainNavRef.current;
    if (!nav) return;

    const handleWheel = (event: WheelEvent) => {
      if (nav.scrollWidth <= nav.clientWidth) return;
      const distance = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      nav.scrollLeft += distance;
      event.preventDefault();
    };

    nav.addEventListener('wheel', handleWheel, { passive: false });
    return () => nav.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const portraitQuery = window.matchMedia('(max-width: 560px) and (orientation: portrait)');
    const updateProjectCollapse = (event: MediaQueryListEvent) => setMobileProjectCollapsed(event.matches);
    portraitQuery.addEventListener('change', updateProjectCollapse);
    return () => portraitQuery.removeEventListener('change', updateProjectCollapse);
  }, []);

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const activeBike = garage.bikes.find((bike) => bike.id === garage.activeBikeId) ?? garage.bikes[0] ?? null;
  const openTasks = garage.bikes.reduce(
    (total, bike) => total + bike.tasks.filter((task) => !task.done).length,
    0,
  );
  const allTasks = garage.bikes.reduce((total, bike) => total + bike.tasks.length, 0);
  const completedTasks = allTasks - openTasks;
  const progress = allTasks ? Math.round((completedTasks / allTasks) * 100) : 0;

  const visibleTasks = useMemo(() => {
    if (!activeBike) return [];
    return taskFilter === 'open' ? activeBike.tasks.filter((task) => !task.done) : activeBike.tasks;
  }, [activeBike, taskFilter]);

  const visibleAllTasks = useMemo(
    () => garage.bikes.flatMap((bike) =>
      bike.tasks
        .filter((task) => taskFilter === 'all' || !task.done)
        .map((task) => ({ bike, task })),
    ),
    [garage.bikes, taskFilter],
  );

  const visiblePlanBikes = useMemo(
    () => planBikeFilter === 'all' ? garage.bikes : garage.bikes.filter((bike) => bike.id === planBikeFilter),
    [garage.bikes, planBikeFilter],
  );
  const visibleShoppingItems = useMemo(() => {
    const scopedItems = garage.shoppingItems.filter((item) =>
      shoppingScope === 'all' ||
      (shoppingScope === 'workshop' ? item.bikeId === null : item.bikeId === shoppingScope),
    );
    return shoppingFilter === 'open' ? scopedItems.filter((item) => item.status !== 'Megérkezett') : scopedItems;
  }, [garage.shoppingItems, shoppingFilter, shoppingScope]);

  function updateBike(bikeId: string, update: (bike: Bike) => Bike) {
    setGarage((current) => ({
      ...current,
      bikes: current.bikes.map((bike) => (bike.id === bikeId ? update(bike) : bike)),
    }));
  }

  function addBike(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newBikeName.trim();
    const year = Number(newBikeYear);
    if (!name || !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1) return;

    const bike: Bike = {
      id: createId(),
      name,
      year,
      status: 'Tervezett',
      frameNumber: '',
      engineNumber: '',
      engineCode: '',
      displacementCc: '',
      power: '',
      transmission: '',
      fuel: '',
      ignition: '',
      specifications: [],
      photos: [],
      tasks: [],
      guides: [],
    };
    setGarage((current) => ({ ...current, bikes: [bike, ...current.bikes], activeBikeId: bike.id }));
    setNewBikeName('');
    setNewBikeYear(String(new Date().getFullYear()));
    setShowBikeForm(false);
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const bikeId = String(formData.get('bikeId') ?? activeBike?.id ?? '');
    const bike = garage.bikes.find((candidate) => candidate.id === bikeId);
    const title = String(formData.get('title') ?? '').trim();
    const category = String(formData.get('category') ?? '').trim();
    if (!bike || !title) return;

    const period = String(formData.get('period') ?? '');
    const task: BikeTask = {
      id: createId(),
      title,
      category: category || 'Egyéb',
      done: false,
      period: garage.planningPeriods.includes(period) ? period : garage.planningPeriods[0] ?? 'Bármikor',
    };
    updateBike(bikeId, (currentBike) => ({ ...currentBike, tasks: [task, ...currentBike.tasks] }));
    form.reset();
  }

  function toggleTask(taskId: string) {
    if (!activeBike) return;
    toggleBikeTask(activeBike.id, taskId);
  }

  function toggleBikeTask(bikeId: string, taskId: string) {
    updateBike(bikeId, (bike) => ({
      ...bike,
      tasks: bike.tasks.map((task) => (task.id === taskId ? { ...task, done: !task.done } : task)),
      guides: bike.guides.map((guide) => {
        const task = bike.tasks.find((candidate) => candidate.id === taskId);
        if (!task?.guideId || !task.guidePointId || task.guideId !== guide.id) return guide;
        return {
          ...guide,
          steps: guide.steps.map((step) => ({
            ...step,
            points: step.points.map((point) =>
              point.id === task.guidePointId ? { ...point, done: !task.done } : point,
            ),
          })),
        };
      }),
    }));
  }

  function setTaskPeriod(bikeId: string, taskId: string, period: string) {
    updateBike(bikeId, (bike) => ({
      ...bike,
      tasks: bike.tasks.map((task) => task.id === taskId ? { ...task, period } : task),
    }));
  }

  function removeTask(taskId: string) {
    if (!activeBike) return;
    removeBikeTask(activeBike.id, taskId);
  }

  function removeBikeTask(bikeId: string, taskId: string) {
    updateBike(bikeId, (bike) => ({
      ...bike,
      tasks: bike.tasks.filter((task) => task.id !== taskId),
    }));
  }

  function selectBike(bikeId: string) {
    setGarage((current) => ({ ...current, activeBikeId: bikeId }));
    setGarageListCollapsed(true);
    setActiveView('bike');
  }

  function updateBikeSpecification(bikeId: string, key: SpecificationKey, value: string) {
    updateBike(bikeId, (bike) => ({ ...bike, [key]: value }));
  }

  function addCustomBikeSpecification(bikeId: string, label: string) {
    const trimmedLabel = label.trim().slice(0, 60);
    if (!trimmedLabel) return;
    updateBike(bikeId, (bike) => ({
      ...bike,
      specifications: [...(bike.specifications ?? []), { id: createId(), label: trimmedLabel, value: '' }],
    }));
  }

  function updateCustomBikeSpecification(bikeId: string, specificationId: string, key: 'label' | 'value', value: string) {
    updateBike(bikeId, (bike) => ({
      ...bike,
      specifications: (bike.specifications ?? []).map((specification) =>
        specification.id === specificationId ? { ...specification, [key]: value } : specification,
      ),
    }));
  }

  function removeCustomBikeSpecification(bikeId: string, specificationId: string) {
    updateBike(bikeId, (bike) => ({
      ...bike,
      specifications: (bike.specifications ?? []).filter((specification) => specification.id !== specificationId),
    }));
  }

  async function addBikePhoto(bikeId: string, file: File, tag: string, comment: string, date: string): Promise<boolean> {
    if (!file.type.startsWith('image/')) {
      setStorageMessage('Csak képfájl tölthető fel fotódokumentációként.');
      return false;
    }
    if (file.size > 15 * 1024 * 1024) {
      setStorageMessage('A kiválasztott fotó nagyobb 15 MB-nál. Válassz kisebb fájlt.');
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setStorageMessage('Adj meg érvényes dátumot a fotóhoz.');
      return false;
    }
    const bike = garage.bikes.find((candidate) => candidate.id === bikeId);
    if (!bike) return false;

    try {
      const blob = await compressPhoto(file);
      let persistent = false;
      if (navigator.storage?.persist) {
        try {
          persistent = await navigator.storage.persist();
        } catch (error) {
          console.error('A böngésző nem tudta megerősíteni a tartós helyi tárhelyet:', error);
        }
      }
      const photo: BikePhoto = {
        id: createId(),
        date,
        tag: tag.trim().slice(0, 40) || 'Egyéb',
        comment: comment.trim().slice(0, 300),
        createdAt: new Date().toISOString(),
      };
      await saveBikePhoto(bikeId, photo.id, blob);
      updateBike(bikeId, (currentBike) => ({ ...currentBike, photos: [photo, ...(currentBike.photos ?? [])] }));
      let capacity = '';
      if (navigator.storage?.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          if (estimate.usage !== undefined && estimate.quota !== undefined) {
            capacity = ` Tárhelyhasználat: ${(estimate.usage / 1024 / 1024).toFixed(1)} / ${(estimate.quota / 1024 / 1024).toFixed(0)} MB.`;
          }
        } catch (error) {
          console.error('A böngésző tárhelyhasználatát nem sikerült lekérdezni:', error);
        }
      }
      setStorageMessage(`A fotó helyben, az eszköz képtárába mentve.${persistent ? ' A böngésző tartós tárolást engedélyezett.' : ' A tárhely böngészőnként és eszközönként korlátozott, ezért készíts rendszeresen biztonsági mentést.'}${capacity}`);
      return true;
    } catch (error) {
      console.error('A motor dokumentációs fotóját nem sikerült feldolgozni:', error);
      setStorageMessage(error instanceof Error ? error.message : 'A fotót nem sikerült feldolgozni.');
      return false;
    }
  }

  function updateBikePhotoComment(bikeId: string, photoId: string, comment: string) {
    updateBike(bikeId, (bike) => ({
      ...bike,
      photos: (bike.photos ?? []).map((photo) => photo.id === photoId ? { ...photo, comment: comment.slice(0, 300) } : photo),
    }));
  }

  function updateBikePhotoDate(bikeId: string, photoId: string, date: string) {
    updateBike(bikeId, (bike) => ({
      ...bike,
      photos: (bike.photos ?? []).map((photo) => photo.id === photoId ? { ...photo, date } : photo),
    }));
  }

  async function removeBikePhoto(bikeId: string, photoId: string) {
    try {
      await deleteBikePhoto(bikeId, photoId);
      updateBike(bikeId, (bike) => ({
        ...bike,
        photos: (bike.photos ?? []).filter((photo) => photo.id !== photoId),
      }));
      setStorageMessage('A fotó törölve lett a helyi képtárból.');
    } catch (error) {
      console.error('A motor dokumentációs fotóját nem sikerült törölni:', error);
      setStorageMessage(error instanceof Error ? error.message : 'A fotót nem sikerült törölni.');
    }
  }

  function addPlanTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const bikeId = String(formData.get('bikeId') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    const category = String(formData.get('category') ?? '').trim() || 'Egyéb';
    const period = String(formData.get('period') ?? '');
    if (!garage.bikes.some((bike) => bike.id === bikeId) || !title || !garage.planningPeriods.includes(period)) return;

    updateBike(bikeId, (bike) => ({
      ...bike,
      tasks: [{ id: createId(), title, category, period, done: false }, ...bike.tasks],
    }));
    form.reset();
  }

  function addPlanningPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const period = String(formData.get('period') ?? '').trim();
    if (!period) return;
    setGarage((current) => current.planningPeriods.some((item) => item.toLocaleLowerCase() === period.toLocaleLowerCase())
      ? current
      : { ...current, planningPeriods: [...current.planningPeriods, period] });
    setPeriodFilter(period);
    form.reset();
  }

  function removePlanningPeriod(period: string) {
    setGarage((current) => {
      const planningPeriods = current.planningPeriods.filter((item) => item !== period);
      if (planningPeriods.length === 0) return current;
      const fallbackPeriod = planningPeriods.includes('Bármikor') ? 'Bármikor' : planningPeriods[0];
      return {
        ...current,
        planningPeriods,
        bikes: current.bikes.map((bike) => ({
          ...bike,
          tasks: bike.tasks.map((task) =>
            (task.period ?? 'Bármikor') === period ? { ...task, period: fallbackPeriod } : task,
          ),
        })),
      };
    });
    if (periodFilter === period) setPeriodFilter('Összes');
  }

  function addShoppingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get('name') ?? '').trim();
    const quantity = String(formData.get('quantity') ?? '').trim();
    const selectedBikeId = String(formData.get('bikeId') ?? 'workshop');
    const categoryValue = String(formData.get('category') ?? '');
    const category = shoppingCategories.find((candidate) => candidate === categoryValue);
    const bikeId = selectedBikeId === 'workshop' ? null : selectedBikeId;
    if (!name || !category || (bikeId !== null && !garage.bikes.some((bike) => bike.id === bikeId))) return;

    setGarage((current) => ({
      ...current,
      shoppingItems: [{ id: createId(), name, quantity, category, bikeId, status: 'Beszerzendő' }, ...current.shoppingItems],
    }));
    form.reset();
  }

  function updateShoppingStatus(itemId: string, status: ShoppingStatus) {
    setGarage((current) => ({
      ...current,
      shoppingItems: current.shoppingItems.map((item) => item.id === itemId ? { ...item, status } : item),
    }));
  }

  function removeShoppingItem(itemId: string) {
    setGarage((current) => ({
      ...current,
      shoppingItems: current.shoppingItems.filter((item) => item.id !== itemId),
    }));
  }

  function addWorkshopShoppingItem(name: string, quantity: string, bikeId: string | null) {
    if (bikeId !== null && !garage.bikes.some((bike) => bike.id === bikeId)) return;
    setGarage((current) => ({
      ...current,
      shoppingItems: [
        { id: createId(), name, quantity, category: 'Motoralkatrész', bikeId, status: 'Beszerzendő' },
        ...current.shoppingItems,
      ],
    }));
  }

  function saveGuide(guide: AiGuide, addTasks: boolean, chemicals: WorkshopChemical[]) {
    if (!activeBike) return;
    const tasks = addTasks ? toTasks(guide) : [];
    setGarage((current) => {
      const existingNames = new Set(current.workshopChemicals.map((chemical) => chemical.name.toLocaleLowerCase()));
      const newChemicals = chemicals.filter((chemical) => !existingNames.has(chemical.name.toLocaleLowerCase()));
      return {
        ...current,
        workshopChemicals: [...newChemicals, ...current.workshopChemicals],
        bikes: current.bikes.map((bike) => bike.id === activeBike.id ? {
          ...bike,
          guides: [guide, ...bike.guides.filter((saved) => saved.id !== guide.id)],
          tasks: [...tasks, ...bike.tasks],
        } : bike),
      };
    });
    setActiveView(addTasks ? 'tasks' : 'guides');
  }

  function toggleGuidePoint(guideId: string, stepId: string, pointId: string) {
    if (!activeBike) return;
    updateBike(activeBike.id, (bike) => {
      const currentPoint = bike.guides
        .find((guide) => guide.id === guideId)
        ?.steps.find((step) => step.id === stepId)
        ?.points.find((point) => point.id === pointId);
      if (!currentPoint) return bike;
      const done = !currentPoint.done;
      return {
        ...bike,
        guides: bike.guides.map((guide) =>
          guide.id !== guideId
            ? guide
            : {
                ...guide,
                steps: guide.steps.map((step) =>
                  step.id !== stepId
                    ? step
                    : {
                        ...step,
                        points: step.points.map((point) =>
                          point.id === pointId ? { ...point, done } : point,
                        ),
                      },
                ),
              },
        ),
        tasks: bike.tasks.map((task) =>
          task.guideId === guideId && task.guidePointId === pointId ? { ...task, done } : task,
        ),
      };
    });
  }

  function deleteGuide(guideId: string) {
    if (!activeBike) return;
    updateBike(activeBike.id, (bike) => ({
      ...bike,
      guides: bike.guides.filter((guide) => guide.id !== guideId),
    }));
  }

  async function exportBackup() {
    try {
      if (!photosReady) throw new Error('A fotótár előkészítése még folyamatban van. Próbáld újra néhány másodperc múlva.');
      const backupData: GarageData = {
        ...garage,
        bikes: await Promise.all(garage.bikes.map(async (bike) => ({
          ...bike,
          photos: await Promise.all((bike.photos ?? []).map(async (photo) => {
            if (photo.dataUrl) return photo;
            const blob = await getBikePhoto(bike.id, photo.id);
            if (!blob) throw new Error(`A(z) „${bike.name}” motor egyik fotója nem található a helyi képtárban.`);
            return { ...photo, dataUrl: await blobToDataUrl(blob) };
          })),
        }))),
      };
      const backup = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(backup);
      const link = document.createElement('a');
      link.href = url;
      link.download = `muhely-garazs-mentes-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStorageMessage('A biztonsági mentés letöltése elindult.');
      setShowBackupTools(false);
    } catch (error) {
      console.error('A garázs biztonsági mentését nem sikerült exportálni:', error);
      setStorageMessage(error instanceof Error ? error.message : 'A biztonsági mentés letöltése nem sikerült.');
      setShowBackupTools(false);
    }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    try {
      if (!photosReady) throw new Error('A fotótár előkészítése még folyamatban van. Próbáld újra néhány másodperc múlva.');
      const parsed: unknown = JSON.parse(await file.text());
      if (!isGarageData(parsed)) throw new Error('Érvénytelen garázs-adat');
      if (!window.confirm('A biztonsági mentés lecseréli az ezen az eszközön lévő teljes garázst. Biztosan folytatod?')) {
        return;
      }

      const photoRecords = parsed.bikes.flatMap((bike) =>
        (bike.photos ?? []).map((photo) => {
          if (!photo.dataUrl) throw new Error(`A(z) „${bike.name}” motor egyik fotója hiányzik a biztonsági mentésből.`);
          return makeStoredPhoto(bike.id, photo.id, photoDataUrlToBlob(photo.dataUrl));
        }),
      );
      await replaceAllBikePhotos(photoRecords);
      const restored: GarageData = {
        ...parsed,
        bikes: parsed.bikes.map((bike) => ({
          ...bike,
          guides: bike.guides ?? [],
          specifications: bike.specifications ?? [],
          photos: (bike.photos ?? []).map(({ dataUrl: _dataUrl, ...photo }) => ({
            ...photo,
            date: photo.date ?? photo.createdAt.slice(0, 10),
          })),
          engineCode: bike.engineCode ?? '',
          displacementCc: bike.displacementCc ?? '',
          power: bike.power ?? '',
          transmission: bike.transmission ?? '',
          fuel: bike.fuel ?? '',
          ignition: bike.ignition ?? '',
          tasks: bike.tasks.map((task) => {
            const { season, ...rest } = task;
            return { ...rest, period: task.period ?? season ?? 'Bármikor' };
          }),
        })),
        shoppingItems: (parsed.shoppingItems ?? []).map((item) => {
          const { bought, ...rest } = item;
          return { ...rest, status: item.status ?? (bought ? 'Megérkezett' : 'Beszerzendő') };
        }),
        planningPeriods: [...new Set((parsed.planningPeriods?.length ? parsed.planningPeriods : DEFAULT_PLANNING_PERIODS))],
        workshopTempC: parsed.workshopTempC ?? 18,
        workshopTimers: parsed.workshopTimers ?? [],
        workshopChemicals: parsed.workshopChemicals ?? [],
        activeBikeId: parsed.bikes.some((bike) => bike.id === parsed.activeBikeId)
          ? parsed.activeBikeId
          : parsed.bikes[0]?.id ?? '',
      };
      setGarage(restored);
      setPhotoMigrationFailed(false);
      setStorageMessage('A biztonsági mentés sikeresen betöltődött.');
      setShowBackupTools(false);
    } catch (error) {
      console.error('A garázs biztonsági mentését nem sikerült betölteni:', error);
      setStorageMessage('A fájl nem olvasható vagy nem érvényes MűhelyGarázs-mentés. A jelenlegi adatok változatlanok maradtak.');
      setShowBackupTools(false);
    } finally {
      input.value = '';
    }
  }

  async function syncMotorcyclesToNotion() {
    const workerUrl = notionWorkerUrl.trim();
    const syncToken = notionSyncToken.trim();
    if (!workerUrl || !syncToken) {
      setNotionSyncMessage(language === 'de'
        ? 'Trage zuerst die Worker-URL und den Synchronisierungsschlüssel ein.'
        : 'Előbb add meg a Worker címét és a szinkronizálási kulcsot.');
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(workerUrl);
    } catch (error) {
      console.error('Ungültige Notion-Worker-URL:', error);
      setNotionSyncMessage(language === 'de'
        ? 'Die Worker-URL ist ungültig.'
        : 'A Worker címe érvénytelen.');
      return;
    }
    const isLocalHttp = parsedUrl.protocol === 'http:' &&
      (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1');
    if (parsedUrl.protocol !== 'https:' && !isLocalHttp) {
      setNotionSyncMessage(language === 'de'
        ? 'Die Worker-URL muss HTTPS verwenden.'
        : 'A Worker címének HTTPS-t kell használnia.');
      return;
    }

    setNotionSyncing(true);
    setNotionSyncMessage(null);
    try {
      const endpoint = `${workerUrl.replace(/\/+$/, '').replace(/\/sync$/, '')}/sync`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${syncToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bikes: garage.bikes.map(({ id, name, year, status }) => ({ id, name, year, status })),
        }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(result) && typeof result.error === 'string'
          ? result.error
          : `HTTP ${response.status}`;
        throw new Error(message);
      }
      if (!isRecord(result) || typeof result.created !== 'number' || typeof result.updated !== 'number') {
        throw new Error('A Worker ungültige Synchronisierungsdaten zurückgegeben.');
      }
      setNotionSyncMessage(language === 'de'
        ? `Notion-Synchronisierung erfolgreich: ${result.created} neu, ${result.updated} aktualisiert.`
        : `Sikeres Notion-szinkronizálás: ${result.created} új, ${result.updated} frissítve.`);
    } catch (error) {
      console.error('A motorkerékpárok Notion-szinkronizálása nem sikerült:', error);
      setNotionSyncMessage(error instanceof Error
        ? error.message
        : language === 'de'
          ? 'Die Notion-Synchronisierung ist fehlgeschlagen.'
          : 'A Notion-szinkronizálás nem sikerült.');
    } finally {
      setNotionSyncing(false);
    }
  }

  async function installApp() {
    if (!installPrompt) {
      setShowInstallHelp(true);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setIsStandalone(true);
      setInstallPrompt(null);
    } catch (error) {
      console.error('Die Installation der App konnte nicht gestartet werden:', error);
      setStorageMessage('A telepítés nem indult el. Próbáld meg a böngésző menüjéből telepíteni az alkalmazást.');
    }
  }

  return (
    <LanguageContext.Provider value={{ language, t }}>
    <Localized>
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="MűhelyGarázs főoldal" onClick={() => setActiveView('garage')}>
          <span className="brand-mark" aria-hidden="true">M</span>
          <span className="brand-name">Műhely<span>Garázs</span></span>
        </a>
        <div className="topbar-right">
          {!isOnline && <span className="offline-badge" role="status"><span /> Offline — mentés helyben</span>}
          <button
            className="header-menu-button"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={showBackupTools}
            onClick={() => setShowBackupTools(true)}
          >
            ☰ Menü
          </button>
        </div>
      </header>

      <main className="page">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">SAJÁT MOTOROS MŰHELYED</p>
            <h1>{ownerName.trim()
              ? language === 'de'
                ? `Guten Tag, ${ownerName.trim()}!`
                : `Jó napot, ${ownerName.trim()}!`
              : t('Jó napot, Műhely!')} <span className="wave">✳</span></h1>
            <p className="welcome-copy">Minden projekted és teendőd egy helyen.</p>
          </div>
          <button className="button button-primary" type="button" onClick={() => setShowBikeForm(true)}>
            <span className="button-plus">＋</span> Új motor
          </button>
        </section>

        <div className="main-nav-shell">
          <nav
            ref={mainNavRef}
            className="main-nav"
            aria-label="Fő navigáció – oldalirányban görgethető"
          >
            <button className={activeView === 'garage' || activeView === 'bike' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('garage')}>
              <span className="nav-icon">▦</span> Garázs
            </button>
            <button className={activeView === 'tasks' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('tasks')}>
              <span className="nav-icon">☷</span> Teendők <span className="nav-count">{openTasks}</span>
            </button>
            <button className={activeView === 'plan' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('plan')}>
              <span className="nav-icon">◷</span> Tervek
            </button>
            <button className={activeView === 'shopping' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('shopping')}>
              <span className="nav-icon">🛒</span> Bevásárlólista <span className="nav-count">{garage.shoppingItems.filter((item) => item.status !== 'Megérkezett').length}</span>
            </button>
            <button className={activeView === 'tools' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('tools')}>
              <span className="nav-icon">⚗</span> Műhely eszközök
            </button>
            <button className={activeView === 'guides' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('guides')}>
              <span className="nav-icon">✦</span> AI útmutatók <span className="nav-count">{activeBike?.guides.length ?? 0}</span>
            </button>
          </nav>
          <button className="main-nav-scroll-button" type="button" aria-label="További menüpontok megjelenítése" onClick={() => mainNavRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}>›</button>
        </div>

        {storageMessage && (
          <div className="notice" role="status">
            <span>{storageMessage}</span>
            <button type="button" onClick={() => setStorageMessage(null)} aria-label="Értesítés bezárása">×</button>
          </div>
        )}

        <section className={activeView === 'tasks' ? 'stats-grid stats-grid-tasks' : 'stats-grid'} aria-label="Összesített haladás">
          {activeView !== 'tasks' && (
            <>
              <article className="stat-card">
                <span className="stat-label">MOTOR A GARÁZSBAN</span>
                <strong>{garage.bikes.length.toString().padStart(2, '0')}</strong>
                <span className="stat-foot">aktív projekt</span>
                <span className="stat-decoration">⌁</span>
              </article>
              <article className="stat-card">
                <span className="stat-label">NYITOTT TEENDŐ</span>
                <strong>{openTasks.toString().padStart(2, '0')}</strong>
                <span className="stat-foot">elvégzésre vár</span>
                <span className="stat-decoration">↗</span>
              </article>
            </>
          )}
          <article className="stat-card stat-progress">
            <div className="stat-progress-heading">
              <span className="stat-label">ÖSSZESÍTETT HALADÁS</span>
              <strong>{progress}%</strong>
            </div>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            <span className="stat-foot">
              {activeView === 'tasks' && <><strong>{openTasks} nyitott</strong> · </>}
              {completedTasks} / {allTasks} feladat kész
            </span>
          </article>
        </section>

        {activeView === 'bike' ? (
          activeBike ? (
            <BikeProfile
              bike={activeBike}
              tasks={visibleTasks}
              taskFilter={taskFilter}
              onFilterChange={setTaskFilter}
              planningPeriods={garage.planningPeriods}
              mobileProjectCollapsed={mobileProjectCollapsed}
              onBack={() => setActiveView('garage')}
              onToggleMobileProject={() => setMobileProjectCollapsed((collapsed) => !collapsed)}
              onStatusChange={(status) => updateBike(activeBike.id, (current) => ({ ...current, status }))}
              onAddTask={addTask}
              onToggleTask={toggleTask}
              onRemoveTask={removeTask}
              onShowTasks={() => setActiveView('tasks')}
              onUpdateSpecification={(key, value) => updateBikeSpecification(activeBike.id, key, value)}
              onAddSpecification={(label) => addCustomBikeSpecification(activeBike.id, label)}
              onUpdateCustomSpecification={(id, key, value) => updateCustomBikeSpecification(activeBike.id, id, key, value)}
              onRemoveCustomSpecification={(id) => removeCustomBikeSpecification(activeBike.id, id)}
              onAddPhoto={(file, tag, comment, date) => addBikePhoto(activeBike.id, file, tag, comment, date)}
              onUpdatePhotoComment={(photoId, comment) => updateBikePhotoComment(activeBike.id, photoId, comment)}
              onUpdatePhotoDate={(photoId, date) => updateBikePhotoDate(activeBike.id, photoId, date)}
              onRemovePhoto={(photoId) => removeBikePhoto(activeBike.id, photoId)}
            />
          ) : (
            <section className="panel guide-empty-state">
              <h2>Válassz ki előbb egy motort</h2>
              <button className="button button-primary" type="button" onClick={() => setActiveView('garage')}>Vissza a garázshoz</button>
            </section>
          )
        ) : activeView === 'guides' ? (
          activeBike ? (
            <AiGuideStudio
              key={activeBike.id}
              bikeName={`${activeBike.name} (${activeBike.year})`}
              language={language}
              guides={activeBike.guides}
              onSaveGuide={saveGuide}
              onTogglePoint={toggleGuidePoint}
              onDeleteGuide={deleteGuide}
            />
          ) : (
            <section className="panel guide-empty-state">
              <span className="empty-icon">✦</span>
              <h2>Válassz ki előbb egy motort</h2>
              <p>Az AI-útmutatókat az adott motor projektjéhez mentjük.</p>
              <button className="button button-primary" type="button" onClick={() => setActiveView('garage')}>Ugrás a Garázsba</button>
            </section>
          )
        ) : activeView === 'plan' ? (
          <SeasonPlanner
            bikes={visiblePlanBikes}
            allBikes={garage.bikes}
            periods={garage.planningPeriods}
            periodFilter={periodFilter}
            bikeFilter={planBikeFilter}
            onPeriodFilterChange={setPeriodFilter}
            onBikeFilterChange={setPlanBikeFilter}
            onAddTask={addPlanTask}
            onAddPeriod={addPlanningPeriod}
            onRemovePeriod={removePlanningPeriod}
            onToggleTask={toggleBikeTask}
            onRemoveTask={removeBikeTask}
            onSetTaskPeriod={setTaskPeriod}
          />
        ) : activeView === 'shopping' ? (
          <ShoppingList
            items={visibleShoppingItems}
            allItems={garage.shoppingItems}
            bikes={garage.bikes}
            filter={shoppingFilter}
            scope={shoppingScope}
            onFilterChange={setShoppingFilter}
            onScopeChange={setShoppingScope}
            onAddItem={addShoppingItem}
            onUpdateStatus={updateShoppingStatus}
            onRemoveItem={removeShoppingItem}
          />
        ) : activeView === 'tools' ? (
          <WorkshopTools
            bikes={garage.bikes}
            workshopTempC={garage.workshopTempC}
            timers={garage.workshopTimers}
            chemicals={garage.workshopChemicals}
            onTemperatureChange={(temperature) => setGarage((current) => ({ ...current, workshopTempC: temperature }))}
            onStartTimer={(timer) => setGarage((current) => ({ ...current, workshopTimers: [timer, ...current.workshopTimers] }))}
            onDeleteTimer={(timerId) => setGarage((current) => ({ ...current, workshopTimers: current.workshopTimers.filter((timer) => timer.id !== timerId) }))}
            onAddChemical={(chemical) => setGarage((current) => ({ ...current, workshopChemicals: [chemical, ...current.workshopChemicals] }))}
            onRemoveChemical={(chemicalId) => setGarage((current) => ({ ...current, workshopChemicals: current.workshopChemicals.filter((chemical) => chemical.id !== chemicalId) }))}
            onAddShoppingItem={addWorkshopShoppingItem}
          />
        ) : activeView === 'garage' ? (
          <>
            <section className="garage-directory panel">
              <div className="garage-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">A GYŰJTEMÉNYED</p>
                    <h2>Garázs <span className="heading-count">{garage.bikes.length}</span></h2>
                  </div>
                  <div className="garage-actions">
                    {garage.bikes.length > 1 && (
                      <button className="garage-collapse-button" type="button" onClick={() => setGarageListCollapsed((collapsed) => !collapsed)}>
                        {garageListCollapsed ? <>{t('Továbbiak')} ({garage.bikes.length - 1})</> : 'Összecsukás'}
                      </button>
                    )}
                    <button className="icon-button" type="button" onClick={() => setShowBikeForm(true)} aria-label="Új motor hozzáadása">＋</button>
                  </div>
                </div>
                <div className="bike-list">
                  {garage.bikes.filter((bike) => !garageListCollapsed || bike.id === activeBike?.id).map((bike, index) => {
                    const done = bike.tasks.filter((task) => task.done).length;
                    const bikeProgress = bike.tasks.length ? Math.round((done / bike.tasks.length) * 100) : 0;
                    const selected = bike.id === activeBike?.id;
                    return (
                      <button
                        className={selected ? 'bike-card selected' : 'bike-card'}
                        key={bike.id}
                        type="button"
                        onClick={() => selectBike(bike.id)}
                        aria-label={`${bike.name} ${t('adatlapjának megnyitása')}`}
                      >
                        <span className={`bike-thumb bike-thumb-${index % 2}`} aria-hidden="true">
                          <svg viewBox="0 0 90 55" role="presentation">
                            <circle cx="20" cy="40" r="11" /><circle cx="70" cy="40" r="11" />
                            <path d="M20 40 33 23h18l19 17M33 23l10 17h27M51 23l8-8h8M37 20h-8" />
                            <path d="M43 40l8-17M33 23l-5-5" />
                          </svg>
                        </span>
                        <span className="bike-info">
                          <span className="bike-title-row"><strong>{bike.name}</strong><span className={`status-dot status-${bike.status === 'Kész' ? 'done' : bike.status === 'Áll' ? 'paused' : 'active'}`} /></span>
                          <span className="bike-year">{bike.year} <span>·</span> {bike.status}</span>
                          <span className="bike-mini-progress"><span style={{ width: `${bikeProgress}%` }} /></span>
                        </span>
                        <span className="bike-chevron">›</span>
                      </button>
                    );
                  })}
                  {garage.bikes.length === 0 && (
                    <div className="empty-garage">
                      <span>⌁</span>
                      <strong>Még üres a garázs</strong>
                      <small>Adj hozzá egy motort az induláshoz.</small>
                    </div>
                  )}
                </div>
                <button className="add-bike-link" type="button" onClick={() => setShowBikeForm(true)}>＋ Új motor hozzáadása</button>
              </div>
            </section>
            <HomeTasksPanel
              bikes={garage.bikes}
              planningPeriods={garage.planningPeriods}
              onAddTask={addTask}
              onToggleTask={toggleBikeTask}
              onOpenBike={(bikeId) => selectBike(bikeId)}
            />
          </>
        ) : (
          <section className="tasks-page panel">
            <div className="panel-heading tasks-page-heading">
              <div>
                <p className="eyebrow">A KÖVETKEZŐ LÉPÉSEK</p>
                <h2>Teendők <span className="heading-count">{openTasks} nyitott</span></h2>
              </div>
              <span className="selected-bike-label">{t('Minden motor együtt')}</span>
            </div>
            {garage.bikes.length ? (
              <>
                <form className="task-form" onSubmit={addTask}>
                  <label className="sr-only" htmlFor="global-task-title">Új teendő neve</label>
                  <input id="global-task-title" name="title" placeholder="Mit kell megcsinálni ezen a motoron?" required />
                  <label className="sr-only" htmlFor="global-task-bike">Motorkerékpár</label>
                  <select id="global-task-bike" name="bikeId" required defaultValue={activeBike?.id ?? garage.bikes[0].id}>
                    {garage.bikes.map((bike) => <option key={bike.id} value={bike.id}>{bike.name}</option>)}
                  </select>
                  <label className="sr-only" htmlFor="global-task-category">Munkaterület</label>
                  <input id="global-task-category" name="category" placeholder="Munkaterület" />
                  <label className="sr-only" htmlFor="global-task-period">Tervezett időszak</label>
                  <select id="global-task-period" name="period" defaultValue={garage.planningPeriods.includes('Bármikor') ? 'Bármikor' : garage.planningPeriods[0]} aria-label="Tervezett időszak">
                    {garage.planningPeriods.map((period) => <option key={period} value={period}>{period}</option>)}
                  </select>
                  <button className="button button-primary" type="submit">＋ Hozzáadás</button>
                </form>
                <TaskList
                  tasks={visibleAllTasks}
                  filter={taskFilter}
                  onFilterChange={setTaskFilter}
                  onToggle={toggleBikeTask}
                  onRemove={removeBikeTask}
                />
              </>
            ) : (
              <div className="empty-tasks"><p>Válassz ki vagy adj hozzá egy motort a teendők kezeléséhez.</p><button className="button button-primary" onClick={() => setShowBikeForm(true)}>＋ Motor hozzáadása</button></div>
            )}
          </section>
        )}
      </main>

      <footer className="footer"><span>MŰHELYGARÁZS</span><span>Az első csavaroktól az utolsó próbakörig.</span></footer>

      {showBikeForm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBikeForm(false); }}>
          <section className="bike-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-heading">
              <div><p className="eyebrow">ÚJ PROJEKT</p><h2 id="modal-title">Motor hozzáadása</h2></div>
              <button className="icon-button" type="button" onClick={() => setShowBikeForm(false)} aria-label="Bezárás">×</button>
            </div>
            <form className="bike-form" onSubmit={addBike}>
              <label htmlFor="bike-name">Motor neve / típusa</label>
              <input id="bike-name" autoFocus maxLength={80} required placeholder="pl. Pannónia T5" value={newBikeName} onChange={(event) => setNewBikeName(event.target.value)} />
              <label htmlFor="bike-year">Évjárat</label>
              <input id="bike-year" type="number" min="1900" max={new Date().getFullYear() + 1} required value={newBikeYear} onChange={(event) => setNewBikeYear(event.target.value)} />
              <p className="form-hint">Az alváz- és motorszámot később, a motor adatlapján is megadhatod.</p>
              <div className="modal-actions">
                <button className="button button-secondary" type="button" onClick={() => setShowBikeForm(false)}>Mégse</button>
                <button className="button button-primary" type="submit">Motor létrehozása <span>→</span></button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showBackupTools && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBackupTools(false); }}>
          <section className="bike-modal" role="dialog" aria-modal="true" aria-labelledby="backup-title">
            <div className="modal-heading">
              <div><p className="eyebrow">MŰHELYGARÁZS</p><h2 id="backup-title">Beállítások és adatmentés</h2></div>
              <button className="icon-button" type="button" onClick={() => setShowBackupTools(false)} aria-label="Bezárás">×</button>
            </div>
            <label className="language-setting" htmlFor="app-language">
              <span>{t('Nyelv / Sprache')}</span>
              <select id="app-language" value={language} onChange={(event) => setLanguage(event.target.value === 'de' ? 'de' : 'hu')}>
                <option value="hu">Magyar</option>
                <option value="de">Deutsch</option>
              </select>
            </label>
            <label className="name-setting" htmlFor="owner-name">
              <span>{t('Megjelenített név')}</span>
              <input
                id="owner-name"
                type="text"
                autoComplete="given-name"
                maxLength={40}
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                placeholder={t('Például: Anna')}
              />
              <small>{t('A név csak ezen az eszközön és ebben a böngészőben tárolódik.')}</small>
            </label>
            <section className="notion-sync-settings" aria-labelledby="notion-sync-title">
              <h3 id="notion-sync-title">{t('Notion-szinkronizálás')}</h3>
              <p>{t('A motorlista egyirányú feltöltése Notionba. A Notionból az appba nem tölt vissza adatot.')}</p>
              <label htmlFor="notion-worker-url">
                <span>{t('Cloudflare Worker címe')}</span>
                <input
                  id="notion-worker-url"
                  type="url"
                  autoComplete="url"
                  value={notionWorkerUrl}
                  onChange={(event) => setNotionWorkerUrl(event.target.value)}
                  placeholder="https://muhelygarazs-notion-sync.…workers.dev"
                />
              </label>
              <label htmlFor="notion-sync-token">
                <span>{t('Szinkronizálási kulcs')}</span>
                <input
                  id="notion-sync-token"
                  type="password"
                  autoComplete="off"
                  value={notionSyncToken}
                  onChange={(event) => setNotionSyncToken(event.target.value)}
                  placeholder={t('A Cloudflare Worker titkos kulcsa')}
                />
              </label>
              <small>{t('A kulcs csak ezen a böngészőn tárolódik, és legalább 32 véletlen karakter legyen. A Notion API-kulcs a Workerben marad.')}</small>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void syncMotorcyclesToNotion()}
                disabled={notionSyncing}
              >
                {notionSyncing ? t('Szinkronizálás…') : t('Motorkerékpárok szinkronizálása')}
              </button>
              {notionSyncMessage && <p className="notion-sync-message" role="status">{notionSyncMessage}</p>}
            </section>
            <div className="backup-help">
              {!isStandalone && (
                <div className="backup-install">
                  <strong>Használat a telefonodon</strong>
                  <p>Telepítsd az alkalmazást a kezdőképernyőre a gyors eléréshez.</p>
                  <button className="button button-secondary" type="button" onClick={() => { setShowBackupTools(false); void installApp(); }}>↓ Telepítés</button>
                </div>
              )}
              <strong>Biztonsági mentés</strong>
              <p>Az adataid most csak ezen az eszközön, ebben a böngészőben vannak mentve. Készíts rendszeresen fájlba mentést, és őrizd meg biztonságos helyen.</p>
              <p>A mentés tartalmazza a motorokat, műszaki adatokat, fotókat, teendőket és AI-útmutatókat. A forrás-PDF-eket és az API-kulcsot nem tartalmazza.</p>
              <div className="backup-actions">
                <button className="button button-primary" type="button" onClick={() => void exportBackup()} disabled={!photosReady}>↓ Biztonsági mentés letöltése</button>
                <button className="button button-secondary" type="button" onClick={() => backupInputRef.current?.click()} disabled={!photosReady}>↑ Mentés visszatöltése</button>
                <input ref={backupInputRef} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => void importBackup(event)} disabled={!photosReady} />
              </div>
              <p className="backup-warning">A visszatöltés lecseréli a jelenlegi garázs adatait. Előtte tölts le róluk egy mentést.</p>
            </div>
            <div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setShowBackupTools(false)}>Bezárás</button></div>
          </section>
        </div>
      )}

      {showInstallHelp && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowInstallHelp(false); }}>
          <section className="bike-modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
            <div className="modal-heading">
              <div><p className="eyebrow">MŰHELYGARÁZS A KEZDŐKÉPERNYŐN</p><h2 id="install-title">Telepítés a telefonodra</h2></div>
              <button className="icon-button" type="button" onClick={() => setShowInstallHelp(false)} aria-label="Bezárás">×</button>
            </div>
            <div className="install-help">
              {/iphone|ipad|ipod/i.test(navigator.userAgent) ? (
                <ol>
                  <li>Nyisd meg ezt az oldalt a <strong>Safari</strong> böngészőben.</li>
                  <li>Koppints a <strong>Megosztás</strong> gombra.</li>
                  <li>Válaszd a <strong>Hozzáadás a Főképernyőhöz</strong> lehetőséget.</li>
                </ol>
              ) : (
                <ol>
                  <li>Nyisd meg az oldal böngészőmenüjét <strong>⋮</strong>.</li>
                  <li>Válaszd az <strong>Alkalmazás telepítése</strong> vagy a <strong>Hozzáadás a kezdőképernyőhöz</strong> lehetőséget.</li>
                  <li>Erősítsd meg a telepítést.</li>
                </ol>
              )}
              <p>Az alkalmazást legalább egyszer internetkapcsolattal kell megnyitni. Utána az elmentett garázs-adatok internet nélkül is elérhetők.</p>
            </div>
            <div className="modal-actions"><button className="button button-primary" type="button" onClick={() => setShowInstallHelp(false)}>Értem</button></div>
          </section>
        </div>
      )}
    </div>
    </Localized>
    </LanguageContext.Provider>
  );
}

interface BikeDetailsProps {
  bike: Bike;
  tasks: BikeTask[];
  taskFilter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
  onStatusChange: (status: BikeStatus) => void;
  onAddTask: (event: FormEvent<HTMLFormElement>) => void;
  onToggleTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onShowTasks: () => void;
  planningPeriods: string[];
  mobileProjectCollapsed: boolean;
  onToggleMobileProject: () => void;
}

function BikeDetails({
  bike,
  tasks,
  taskFilter,
  onFilterChange,
  onStatusChange,
  onAddTask,
  onToggleTask,
  onRemoveTask,
  onShowTasks,
  planningPeriods,
  mobileProjectCollapsed,
  onToggleMobileProject,
}: BikeDetailsProps) {
  const done = bike.tasks.filter((task) => task.done).length;
  const percentage = bike.tasks.length ? Math.round((done / bike.tasks.length) * 100) : 0;

  return (
    <Localized>
    <section className="bike-details">
      <article className={mobileProjectCollapsed ? 'bike-hero panel project-collapsed' : 'bike-hero panel'}>
        <div className="hero-topline">
          <span className="hero-kicker"><span className="hero-pulse" /> AKTÍV PROJEKT</span>
          <strong className="hero-collapsed-name">{bike.name}</strong>
          <button
            className="project-collapse-toggle"
            type="button"
            aria-expanded={!mobileProjectCollapsed}
            onClick={onToggleMobileProject}
          >
            {mobileProjectCollapsed ? 'Projekt megnyitása' : 'Projekt összecsukása'}
          </button>
          <span className="hero-year">#{bike.year}</span>
        </div>
        <div className="hero-content">
          <div>
            <p className="eyebrow">A TE GÉPED</p>
            <h2>{bike.name}</h2>
            <div className="hero-meta"><span>▣ {bike.frameNumber || 'Alvázszám nincs megadva'}</span><span>◈ {bike.engineNumber || 'Motorszám nincs megadva'}</span></div>
          </div>
          <div className="hero-bike-art" aria-hidden="true">
            <svg viewBox="0 0 260 155" role="presentation">
              <defs><linearGradient id="bikePaint" x1="0" x2="1"><stop stopColor="#c97b32" /><stop offset="1" stopColor="#efb15b" /></linearGradient></defs>
              <circle cx="55" cy="116" r="30" /><circle cx="209" cy="116" r="30" />
              <circle className="wheel-inner" cx="55" cy="116" r="20" /><circle className="wheel-inner" cx="209" cy="116" r="20" />
              <path className="frame" d="m55 116 38-52h50l66 52H55l38-52 29 52 21-52m0 0h25l18 52m-77-52 18-21h24m-99 21H98" />
              <path className="tank" d="M98 64c8-20 27-27 53-21l16 21-18 17h-42z" />
              <path className="engine" d="M112 83h42l16 23h-63z" />
              <path className="frame" d="m194 64 18-14m-29 1h29m-150 65h-19m176 0h20M87 61l-11-9" />
            </svg>
          </div>
        </div>
        <div className="hero-bottom">
          <div className="hero-progress-copy"><span>PROJEKT HALADÁSA</span><strong>{percentage}%</strong></div>
          <div className="hero-progress-track"><span style={{ width: `${percentage}%` }} /></div>
          <div className="hero-status-row">
            <div><span className={`status-dot status-${bike.status === 'Kész' ? 'done' : bike.status === 'Áll' ? 'paused' : 'active'}`} /> Projektállapot</div>
            <label className="sr-only" htmlFor="bike-status">Projektállapot módosítása</label>
            <select id="bike-status" className="status-select" value={bike.status} onChange={(event) => {
              const status = statuses.find((candidate) => candidate === event.target.value);
              if (status) onStatusChange(status);
            }}>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        </div>
      </article>

      <article className="tasks-panel panel">
        <div className="panel-heading task-heading">
          <div><p className="eyebrow">LÉPÉSRŐL LÉPÉSRE</p><h2>Projekt teendői <span className="heading-count">{bike.tasks.filter((task) => !task.done).length} nyitott</span></h2></div>
          <button type="button" className="text-button" onClick={onShowTasks}>Összes <span>→</span></button>
        </div>
        <form className="task-form" onSubmit={onAddTask}>
          <label className="sr-only" htmlFor="task-title">Új teendő neve</label>
          <input id="task-title" name="title" placeholder="Adj hozzá egy új teendőt…" required />
          <label className="sr-only" htmlFor="task-category">Munkaterület</label>
          <select id="task-category" name="category" defaultValue="Blokk & karburátor">
            <option value="Blokk & karburátor">Blokk & karburátor</option><option value="Futómű & fékek">Futómű & fékek</option><option value="Váz & karosszéria">Váz & karosszéria</option><option value="Elektromosság">Elektromosság</option><option value="Tank & üzemanyag">Tank & üzemanyag</option><option value="Egyéb">Egyéb</option>
          </select>
          <label className="sr-only" htmlFor="task-period">Tervezett időszak</label>
          <select id="task-period" name="period" defaultValue="Bármikor" aria-label="Tervezett időszak">
            {planningPeriods.map((period) => <option key={period} value={period}>{period}</option>)}
          </select>
          <button className="button button-primary task-add-button" type="submit" aria-label="Teendő hozzáadása">＋</button>
        </form>
        <TaskList
          tasks={tasks.map((task) => ({ bike, task }))}
          filter={taskFilter}
          onFilterChange={onFilterChange}
          onToggle={(_bikeId, taskId) => onToggleTask(taskId)}
          onRemove={(_bikeId, taskId) => onRemoveTask(taskId)}
        />
      </article>
    </section>
    </Localized>
  );
}

interface BikeProfileProps {
  bike: Bike;
  tasks: BikeTask[];
  taskFilter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
  planningPeriods: string[];
  mobileProjectCollapsed: boolean;
  onBack: () => void;
  onToggleMobileProject: () => void;
  onStatusChange: (status: BikeStatus) => void;
  onAddTask: (event: FormEvent<HTMLFormElement>) => void;
  onToggleTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onShowTasks: () => void;
  onUpdateSpecification: (key: SpecificationKey, value: string) => void;
  onAddSpecification: (label: string) => void;
  onUpdateCustomSpecification: (id: string, key: 'label' | 'value', value: string) => void;
  onRemoveCustomSpecification: (id: string) => void;
  onAddPhoto: (file: File, tag: string, comment: string, date: string) => Promise<boolean>;
  onUpdatePhotoComment: (photoId: string, comment: string) => void;
  onUpdatePhotoDate: (photoId: string, date: string) => void;
  onRemovePhoto: (photoId: string) => Promise<void>;
}

function BikeProfile({
  bike,
  tasks,
  taskFilter,
  onFilterChange,
  planningPeriods,
  mobileProjectCollapsed,
  onBack,
  onToggleMobileProject,
  onStatusChange,
  onAddTask,
  onToggleTask,
  onRemoveTask,
  onShowTasks,
  onUpdateSpecification,
  onAddSpecification,
  onUpdateCustomSpecification,
  onRemoveCustomSpecification,
  onAddPhoto,
  onUpdatePhotoComment,
  onUpdatePhotoDate,
  onRemovePhoto,
}: BikeProfileProps) {
  const { t } = useTranslation();
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoLoadError, setPhotoLoadError] = useState('');
  const photoIds = (bike.photos ?? []).map((photo) => photo.id).join('|');
  const timelinePhotos = [...(bike.photos ?? [])].sort((a, b) =>
    (a.date ?? a.createdAt.slice(0, 10)).localeCompare(b.date ?? b.createdAt.slice(0, 10)) ||
    a.createdAt.localeCompare(b.createdAt),
  );

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    setPhotoUrls({});
    setPhotoLoadError('');
    async function loadPhotos() {
      try {
        const loadedUrls: Record<string, string> = {};
        for (const photoId of photoIds.split('|').filter(Boolean)) {
          const blob = await getBikePhoto(bike.id, photoId);
          if (cancelled) return;
          if (!blob) throw new Error('Egy fotó nem található a helyi képtárban.');
          const url = URL.createObjectURL(blob);
          urls.push(url);
          loadedUrls[photoId] = url;
        }
        if (!cancelled) {
          setPhotoUrls(loadedUrls);
          setPhotoLoadError('');
        }
      } catch (error) {
        urls.forEach((url) => URL.revokeObjectURL(url));
        urls.length = 0;
        console.error('A motor dokumentációs fotóját nem sikerült megjeleníteni:', error);
        if (!cancelled) setPhotoLoadError(error instanceof Error ? error.message : 'A fotókat nem sikerült betölteni.');
      }
    }
    void loadPhotos();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [bike.id, photoIds]);

  async function submitPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get('photo');
    if (!(file instanceof File) || !file.size) return;
    setPhotoUploading(true);
    try {
      const saved = await onAddPhoto(
        file,
        String(formData.get('tag') ?? ''),
        String(formData.get('comment') ?? ''),
        String(formData.get('date') ?? ''),
      );
      if (saved) form.reset();
    } finally {
      setPhotoUploading(false);
    }
  }

  function submitSpecification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    onAddSpecification(String(formData.get('label') ?? ''));
    form.reset();
  }

  return (
    <Localized>
    <div className="bike-profile-page">
      <div className="bike-profile-heading">
        <button className="button button-secondary" type="button" onClick={onBack}>← Vissza a garázshoz</button>
        <div>
          <p className="eyebrow">MOTOR ADATLAPJA</p>
          <h2>{bike.name} <span className="heading-count">{bike.year}</span></h2>
        </div>
      </div>

      <BikeDetails
        bike={bike}
        tasks={tasks}
        taskFilter={taskFilter}
        onFilterChange={onFilterChange}
        onStatusChange={onStatusChange}
        onAddTask={onAddTask}
        onToggleTask={onToggleTask}
        onRemoveTask={onRemoveTask}
        onShowTasks={onShowTasks}
        planningPeriods={planningPeriods}
        mobileProjectCollapsed={mobileProjectCollapsed}
        onToggleMobileProject={onToggleMobileProject}
      />

      <section className="panel bike-specifications-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">MŰSZAKI ADATOK</p><h2>Motorkerékpár adatai</h2></div>
        </div>
        <p className="planning-intro">Az itt megadott adatok csak ezen az eszközön tárolódnak, és bekerülnek a JSON biztonsági mentésbe.</p>
        <div className="technical-spec-grid">
          {specificationFields.map(({ key, label }) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={bike[key] ?? ''}
                onChange={(event) => onUpdateSpecification(key, event.target.value)}
                maxLength={120}
              />
            </label>
          ))}
          {(bike.specifications ?? []).map((specification) => (
            <div className="custom-specification" key={specification.id}>
              <label>
                <span>Egyéni adat neve</span>
                <input
                  value={specification.label}
                  maxLength={60}
                  onChange={(event) => onUpdateCustomSpecification(specification.id, 'label', event.target.value)}
                />
              </label>
              <label>
                <span>{specification.label || 'Egyéni adat'}</span>
                <input
                  value={specification.value}
                  maxLength={160}
                  onChange={(event) => onUpdateCustomSpecification(specification.id, 'value', event.target.value)}
                />
              </label>
              <button
                className="task-remove"
                type="button"
                onClick={() => onRemoveCustomSpecification(specification.id)}
                aria-label={`${t('Egyéni adat törlése')}: ${specification.label}`}
              >×</button>
            </div>
          ))}
        </div>
        <form className="custom-specification-form" onSubmit={submitSpecification}>
          <label>
            <span>Új saját mező</span>
            <input name="label" maxLength={60} required placeholder="Pl. féktárcsa mérete" />
          </label>
          <button className="button button-secondary" type="submit">＋ Mező hozzáadása</button>
        </form>
      </section>

      <section className="panel bike-photos-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">FELÚJÍTÁSI DOKUMENTÁCIÓ</p>
            <h2>Fotók és idővonal <span className="heading-count">{(bike.photos ?? []).length}</span></h2>
          </div>
        </div>
        <p className="planning-intro">Minden fotóhoz dátumot, alkatrészt és megjegyzést adhatsz. A számozott idővonal dátum szerint, a legrégebbitől a legújabbig rendeződik; a dátum később is módosítható. A képek ezen az eszközön maradnak.</p>
        <form className="bike-photo-form" onSubmit={(event) => void submitPhoto(event)}>
          <label>
            <span>Fotó (max. 15 MB, automatikusan optimalizálva)</span>
            <input name="photo" type="file" accept="image/*" capture="environment" required disabled={photoUploading} />
          </label>
          <label>
            <span>A fotó dátuma</span>
            <input name="date" type="date" required defaultValue={localDateString()} disabled={photoUploading} />
          </label>
          <label>
            <span>Alkatrész / kategória</span>
            <input name="tag" maxLength={40} list={`photo-tags-${bike.id}`} placeholder="Pl. karburátor vagy tank" />
            <datalist id={`photo-tags-${bike.id}`}>
              <option value="Karburátor" /><option value="Tank" /><option value="Motorblokk" />
              <option value="Futómű" /><option value="Fékek" /><option value="Elektromosság" />
              <option value="Váz" /><option value="Előtte" /><option value="Utána" />
            </datalist>
          </label>
          <label className="photo-comment-field">
            <span>Megjegyzés</span>
            <textarea name="comment" maxLength={300} placeholder="Mi látható a képen, mit kell megjegyezni?" />
          </label>
          <button className="button button-primary" type="submit" disabled={photoUploading}>
            {photoUploading ? 'Fotó optimalizálása…' : '↑ Fotó mentése'}
          </button>
          <small>A képek az eszköz helyi tárhelyére kerülnek. Nincs alkalmazáson belüli összméret- vagy darabkorlát; az elérhető hely böngészőnként és eszközönként eltér, ezért készíts rendszeresen biztonsági mentést.</small>
        </form>
        {photoLoadError && <p className="storage-message" role="alert">{photoLoadError}</p>}
        {(bike.photos ?? []).length ? (
          <ol className="photo-timeline">
            {timelinePhotos.map((photo, index) => (
              <li className="photo-timeline-entry" key={photo.id}>
                <span className="photo-timeline-marker" aria-hidden="true">{index + 1}</span>
                <article className="bike-photo-card">
                  {photoUrls[photo.id] ? (
                    <img src={photoUrls[photo.id]} alt={`${photo.tag}: ${photo.comment || bike.name}`} loading="lazy" />
                  ) : (
                    <div className="bike-photo-placeholder" aria-label="Fotó betöltése folyamatban">Fotó betöltése…</div>
                  )}
                  <div className="bike-photo-info">
                    <div className="bike-photo-heading">
                      <strong>{photo.tag}</strong>
                    </div>
                    <label>
                      <span>A fotó dátuma</span>
                      <input
                        className="photo-date-input"
                        type="date"
                        value={photo.date ?? photo.createdAt.slice(0, 10)}
                        onChange={(event) => onUpdatePhotoDate(photo.id, event.target.value)}
                      />
                    </label>
                    <label>
                      <span className="sr-only">Fotó megjegyzése: {photo.tag}</span>
                      <textarea
                        value={photo.comment}
                        maxLength={300}
                        placeholder="Megjegyzés hozzáadása…"
                        onChange={(event) => onUpdatePhotoComment(photo.id, event.target.value)}
                      />
                    </label>
                    <button className="photo-delete-button" type="button" onClick={() => onRemovePhoto(photo.id)}>Fotó törlése</button>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-garage bike-photo-empty"><span>▧</span><strong>Még nincs dokumentációs fotó</strong><small>Az első feltöltött kép ehhez a motorhoz lesz rendelve.</small></div>
        )}
      </section>
    </div>
    </Localized>
  );
}

interface HomeTasksPanelProps {
  bikes: Bike[];
  planningPeriods: string[];
  onAddTask: (event: FormEvent<HTMLFormElement>) => void;
  onToggleTask: (bikeId: string, taskId: string) => void;
  onOpenBike: (bikeId: string) => void;
}

function HomeTasksPanel({ bikes, planningPeriods, onAddTask, onToggleTask, onOpenBike }: HomeTasksPanelProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const tasks = bikes.flatMap((bike) =>
    bike.tasks.filter((task) => !task.done).map((task) => ({ bike, task })),
  );
  const displayedTasks = showAll ? tasks : tasks.slice(0, 6);

  return (
    <Localized>
    <section className="home-tasks-panel panel">
      <div className="panel-heading home-tasks-heading">
        <div>
          <p className="eyebrow">MINDEN MOTOR PROJEKTJE</p>
          <h2>Nyitott teendők <span className="heading-count">{tasks.length}</span></h2>
        </div>
        {tasks.length > 6 && (
          <button className="text-button" type="button" onClick={() => setShowAll((current) => !current)}>
            {showAll ? 'Kevesebb' : 'Mind a ' + tasks.length} <span>→</span>
          </button>
        )}
      </div>
      {bikes.length > 0 && (
        <form className="task-form home-task-form" onSubmit={onAddTask}>
          <label className="sr-only" htmlFor="home-task-title">Új teendő</label>
          <input id="home-task-title" name="title" placeholder="Új teendő bármelyik motorhoz…" required />
          <label className="sr-only" htmlFor="home-task-bike">Motor</label>
          <select id="home-task-bike" name="bikeId" aria-label="Motor kiválasztása" defaultValue={bikes[0].id}>
            {bikes.map((bike) => <option key={bike.id} value={bike.id}>{bike.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="home-task-period">Tervezett időszak</label>
          <select id="home-task-period" name="period" aria-label="Tervezett időszak" defaultValue="Bármikor">
            {planningPeriods.map((period) => <option key={period} value={period}>{period}</option>)}
          </select>
          <button className="button button-primary task-add-button" type="submit" aria-label="Teendő hozzáadása">＋</button>
        </form>
      )}
      {displayedTasks.length ? (
        <ul className="home-task-list">
          {displayedTasks.map(({ bike, task }) => (
            <li className="task-row" key={`${bike.id}:${task.id}`}>
              <button
                className="task-check"
                type="button"
                onClick={() => onToggleTask(bike.id, task.id)}
                aria-label={`${t('Feladat készre jelölése')}: ${task.title}`}
              />
              <span className="task-copy">
                <strong>{task.title}</strong>
                <small>{bike.name} · {task.category}{task.period ? <> · {t(task.period)}</> : ''}</small>
              </span>
              <button className="home-task-open" type="button" onClick={() => onOpenBike(bike.id)} aria-label={`${bike.name} ${t('adatlapjának megnyitása')}`}>
                Motor megnyitása →
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-tasks home-tasks-empty">
          <span>✓</span>
          <strong>{bikes.length ? 'Minden teendő kész!' : 'Még nincs motor a garázsban'}</strong>
          <small>{bikes.length ? 'A nyitott feladatok minden projektből itt jelennek meg.' : 'Adj hozzá egy motort, majd rögzítsd az első teendődet.'}</small>
        </div>
      )}
    </section>
    </Localized>
  );
}

interface TaskListProps {
  tasks: { bike: Bike; task: BikeTask }[];
  filter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
  onToggle: (bikeId: string, taskId: string) => void;
  onRemove: (bikeId: string, taskId: string) => void;
}

function TaskList({ tasks, filter, onFilterChange, onToggle, onRemove }: TaskListProps) {
  const { t } = useTranslation();
  return (
    <Localized>
    <>
      <div className="task-list-toolbar">
        <div className="filter-tabs" role="group" aria-label="Teendők szűrése">
          <button type="button" className={filter === 'open' ? 'filter-tab active' : 'filter-tab'} onClick={() => onFilterChange('open')}>Nyitott</button>
          <button type="button" className={filter === 'all' ? 'filter-tab active' : 'filter-tab'} onClick={() => onFilterChange('all')}>Összes</button>
        </div>
        <span className="task-total">{tasks.length} {t(tasks.length === 1 ? 'feladat' : 'feladatok')}</span>
      </div>
      {tasks.length ? (
        <ul className="task-list">
          {tasks.map(({ bike, task }) => (
            <li className={task.done ? 'task-row is-done' : 'task-row'} key={`${bike.id}:${task.id}`}>
              <button className="task-check" type="button" onClick={() => onToggle(bike.id, task.id)} aria-label={task.done ? 'Feladat visszaállítása nyitottra' : 'Feladat készre jelölése'} aria-pressed={task.done}>
                {task.done ? '✓' : ''}
              </button>
              <span className="task-copy"><strong>{task.title}</strong><small>{bike.name} · {task.category}</small></span>
              <button className="task-remove" type="button" onClick={() => onRemove(bike.id, task.id)} aria-label={`${t('Teendő törlése')}: ${task.title}`}>×</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-tasks"><span>✓</span><strong>{filter === 'open' ? 'Minden feladat kész!' : 'Még nincsenek teendők.'}</strong><small>{filter === 'open' ? 'Szép munka. Jöhet a következő munkafázis.' : 'Adj hozzá egy teendőt a projekthez.'}</small></div>
      )}
    </>
    </Localized>
  );
}

interface SeasonPlannerProps {
  bikes: Bike[];
  allBikes: Bike[];
  periods: string[];
  periodFilter: PlanningPeriodFilter;
  bikeFilter: string;
  onPeriodFilterChange: (period: PlanningPeriodFilter) => void;
  onBikeFilterChange: (bikeId: string) => void;
  onAddTask: (event: FormEvent<HTMLFormElement>) => void;
  onAddPeriod: (event: FormEvent<HTMLFormElement>) => void;
  onRemovePeriod: (period: string) => void;
  onToggleTask: (bikeId: string, taskId: string) => void;
  onRemoveTask: (bikeId: string, taskId: string) => void;
  onSetTaskPeriod: (bikeId: string, taskId: string, period: string) => void;
}

function SeasonPlanner({
  bikes,
  allBikes,
  periods,
  periodFilter,
  bikeFilter,
  onPeriodFilterChange,
  onBikeFilterChange,
  onAddTask,
  onAddPeriod,
  onRemovePeriod,
  onToggleTask,
  onRemoveTask,
  onSetTaskPeriod,
}: SeasonPlannerProps) {
  const { language, t } = useTranslation();
  const plannedPeriods = periodFilter === 'Összes' ? periods : [periodFilter];
  const periodsWithTasks = plannedPeriods.map((period) => ({
    period,
    tasks: bikes.flatMap((bike) =>
      bike.tasks
        .filter((task) => (task.period ?? 'Bármikor') === period)
        .map((task) => ({ bike, task })),
    ),
  }));
  const taskCount = periodsWithTasks.reduce((count, group) => count + group.tasks.length, 0);

  return (
    <Localized>
    <section className="planning-page panel">
      <div className="panel-heading planning-heading">
        <div>
          <p className="eyebrow">MUNKÁK SAJÁT IDŐSZAKOK SZERINT</p>
          <h2>Tervezés <span className="heading-count">{taskCount} {t(taskCount === 1 ? 'teendő' : 'teendők')}</span></h2>
        </div>
        <span className="selected-bike-label">
          {bikeFilter === 'all' ? 'Minden motor együtt' : allBikes.find((bike) => bike.id === bikeFilter)?.name ?? 'Motorkerékpár'}
        </span>
      </div>
      <p className="planning-intro">Használd az évszakokat, vagy hozz létre saját időszakokat, például „Napi terv”, „November” vagy „Téli felújítás”.</p>
      <form className="period-form" onSubmit={onAddPeriod}>
        <label className="sr-only" htmlFor="new-planning-period">Új időszak neve</label>
        <input id="new-planning-period" name="period" maxLength={40} placeholder="Új terv neve, pl. Napi terv vagy November" required />
        <button className="button button-secondary" type="submit">＋ Időszak létrehozása</button>
      </form>
      <form className="task-form planner-form" onSubmit={onAddTask}>
        <label className="sr-only" htmlFor="planner-task-title">Új teendő</label>
        <input id="planner-task-title" name="title" placeholder="Milyen munkát tervezzünk?" required />
        <label className="sr-only" htmlFor="planner-bike">Motorkerékpár</label>
        <select id="planner-bike" name="bikeId" required defaultValue={allBikes[0]?.id ?? ''} disabled={!allBikes.length}>
          {allBikes.map((bike) => <option key={bike.id} value={bike.id}>{bike.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="planner-period">Időszak</label>
        <select id="planner-period" name="period" key={periodFilter} defaultValue={periodFilter === 'Összes' ? 'Bármikor' : periodFilter}>
          {periods.map((period) => <option key={period} value={period}>{period}</option>)}
        </select>
        <label className="sr-only" htmlFor="planner-category">Munkaterület</label>
        <select id="planner-category" name="category" defaultValue="Egyéb">
          <option value="Blokk & karburátor">Blokk & karburátor</option><option value="Futómű & fékek">Futómű & fékek</option><option value="Váz & karosszéria">Váz & karosszéria</option><option value="Elektromosság">Elektromosság</option><option value="Tank & üzemanyag">Tank & üzemanyag</option><option value="Egyéb">Egyéb</option>
        </select>
        <button className="button button-primary task-add-button" type="submit" aria-label="Teendő hozzáadása" disabled={!allBikes.length}>＋</button>
      </form>
      <div className="planner-filters">
        <label>
          <span>Időszak</span>
          <select value={periodFilter} onChange={(event) => onPeriodFilterChange(event.target.value)}>
            <option value="Összes">Összes</option>
            {periods.map((period) => <option key={period} value={period}>{period}</option>)}
          </select>
        </label>
        <label>
          <span>Motorkerékpár</span>
          <select value={bikeFilter} onChange={(event) => onBikeFilterChange(event.target.value)}>
            <option value="all">Minden motor</option>
            {allBikes.map((bike) => <option key={bike.id} value={bike.id}>{bike.name}</option>)}
          </select>
        </label>
      </div>
      <div className="season-groups">
        {periodsWithTasks.map(({ period, tasks }) => (
          <section className="season-group" key={period}>
            <div className="season-group-heading">
              <h3>{period}</h3>
              <span>{tasks.length} {t(tasks.length === 1 ? 'teendő' : 'teendők')}</span>
            </div>
            <button
              className="period-delete-button"
              type="button"
              disabled={periods.length < 2}
              title={tasks.length
                ? language === 'de'
                  ? `${tasks.length} Aufgaben werden in einen anderen Zeitraum verschoben.`
                  : `${tasks.length} teendő átkerül egy másik időszakba.`
                : t('Időszak törlése')}
              onClick={() => onRemovePeriod(period)}
            >
              {t('Időszak törlése')}{tasks.length ? <> · {tasks.length} {t('teendő')} {t('áthelyezése')}</> : ''}
            </button>
            {tasks.length ? (
              <ul className="task-list planner-task-list">
                {tasks.map(({ bike, task }) => (
                  <li className={task.done ? 'task-row is-done' : 'task-row'} key={`${bike.id}-${task.id}`}>
                    <button className="task-check" type="button" onClick={() => onToggleTask(bike.id, task.id)} aria-label={task.done ? 'Feladat visszaállítása nyitottra' : 'Feladat készre jelölése'} aria-pressed={task.done}>
                      {task.done ? '✓' : ''}
                    </button>
                    <span className="task-copy">
                      <strong>{task.title}</strong>
                      <small>{bike.name} · {task.category}</small>
                    </span>
                    <label className="sr-only" htmlFor={`period-${bike.id}-${task.id}`}>Teendő időszakának módosítása</label>
                    <select id={`period-${bike.id}-${task.id}`} className="planner-task-season" value={task.period ?? 'Bármikor'} onChange={(event) => {
                      if (periods.includes(event.target.value)) onSetTaskPeriod(bike.id, task.id, event.target.value);
                    }}>
                      {periods.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <button className="task-remove" type="button" onClick={() => onRemoveTask(bike.id, task.id)} aria-label={`${t('Teendő törlése')}: ${task.title}`}>×</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="season-empty">Ehhez az időszakhoz még nincs teendő.</p>
            )}
          </section>
        ))}
      </div>
    </section>
    </Localized>
  );
}

interface ShoppingListProps {
  items: ShoppingItem[];
  allItems: ShoppingItem[];
  bikes: Bike[];
  filter: TaskFilter;
  scope: string;
  onFilterChange: (filter: TaskFilter) => void;
  onScopeChange: (scope: string) => void;
  onAddItem: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateStatus: (itemId: string, status: ShoppingStatus) => void;
  onRemoveItem: (itemId: string) => void;
}

function ShoppingList({
  items,
  allItems,
  bikes,
  filter,
  scope,
  onFilterChange,
  onScopeChange,
  onAddItem,
  onUpdateStatus,
  onRemoveItem,
}: ShoppingListProps) {
  const { t } = useTranslation();
  const pendingCount = allItems.filter((item) => item.status === 'Beszerzendő').length;
  const orderedCount = allItems.filter((item) => item.status === 'Megrendelve').length;
  const arrivedCount = allItems.filter((item) => item.status === 'Megérkezett').length;
  const itemBike = (bikeId: string | null) => bikes.find((bike) => bike.id === bikeId)?.name ?? 'Közös műhely';

  return (
    <Localized>
    <section className="shopping-page panel">
      <div className="panel-heading planning-heading">
        <div>
          <p className="eyebrow">ALKATRÉSZEK ÉS MŰHELYKELLÉKEK</p>
          <h2>Bevásárlólista <span className="heading-count">{pendingCount} {t('beszerzendő')}</span></h2>
        </div>
        <span className="selected-bike-label">{orderedCount} {t('megrendelve')} · {arrivedCount} {t('megérkezett')}</span>
      </div>
      <p className="planning-intro">Vezesd együtt a motorok alkatrészeit és a közös műhely fogyóeszközeit, például a féktisztítót vagy a csavarokat.</p>
      <form className="task-form shopping-form" onSubmit={onAddItem}>
        <label className="sr-only" htmlFor="shopping-name">Mit kell beszerezni?</label>
        <input id="shopping-name" name="name" placeholder="pl. féktisztító, M6-os csavar…" required />
        <label className="sr-only" htmlFor="shopping-quantity">Mennyiség</label>
        <input id="shopping-quantity" className="shopping-quantity" name="quantity" placeholder="Mennyiség" />
        <label className="sr-only" htmlFor="shopping-category">Típus</label>
        <select id="shopping-category" name="category" defaultValue="Műhelyanyag">
          {shoppingCategories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <label className="sr-only" htmlFor="shopping-bike">Hová kerüljön?</label>
        <select id="shopping-bike" name="bikeId" defaultValue="workshop">
          <option value="workshop">Közös műhelylista</option>
          {bikes.map((bike) => <option key={bike.id} value={bike.id}>{bike.name}</option>)}
        </select>
        <button className="button button-primary task-add-button" type="submit" aria-label="Tétel hozzáadása">＋</button>
      </form>
      <div className="shopping-toolbar">
        <div className="filter-tabs" role="group" aria-label="Bevásárlólista szűrése">
          <button type="button" className={filter === 'open' ? 'filter-tab active' : 'filter-tab'} onClick={() => onFilterChange('open')}>Nyitott</button>
          <button type="button" className={filter === 'all' ? 'filter-tab active' : 'filter-tab'} onClick={() => onFilterChange('all')}>Összes</button>
        </div>
        <label>
          <span className="sr-only">Lista szűrése</span>
          <select value={scope} onChange={(event) => onScopeChange(event.target.value)}>
            <option value="all">Minden tétel</option>
            <option value="workshop">Közös műhely</option>
            {bikes.map((bike) => <option key={bike.id} value={bike.id}>{bike.name}</option>)}
          </select>
        </label>
        <span className="task-total">{items.length} tétel</span>
      </div>
      {items.length ? (
        <ul className="shopping-items">
          {items.map((item) => (
            <li className={item.status === 'Megérkezett' ? 'shopping-row is-bought' : 'shopping-row'} key={item.id}>
              <span className="shopping-item-copy">
                <strong>{item.name}</strong>
                <small>{item.category} · {itemBike(item.bikeId)}</small>
              </span>
              {item.quantity && <span className="shopping-quantity-value">{item.quantity}</span>}
              <label className="sr-only" htmlFor={`shopping-status-${item.id}`}>{t('Beszerzés állapota')}: {item.name}</label>
              <select
                id={`shopping-status-${item.id}`}
                className={`shopping-status shopping-status-${item.status === 'Beszerzendő' ? 'pending' : item.status === 'Megrendelve' ? 'ordered' : 'arrived'}`}
                value={item.status}
                onChange={(event) => {
                  const status = shoppingStatuses.find((candidate) => candidate === event.target.value);
                  if (status) onUpdateStatus(item.id, status);
                }}
              >
                {shoppingStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <button className="task-remove" type="button" onClick={() => onRemoveItem(item.id)} aria-label={`${t('Tétel törlése')}: ${item.name}`}>×</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-tasks shopping-empty">
          <span>✓</span>
          <strong>{filter === 'open' ? 'Nincs nyitott beszerzés.' : 'Még üres a bevásárlólista.'}</strong>
          <small>Adj hozzá műhelyanyagot vagy egy motorhoz szükséges alkatrészt.</small>
        </div>
      )}
    </section>
    </Localized>
  );
}

export default App;
