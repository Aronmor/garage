export type BikeStatus = 'Folyamatban' | 'Tervezett' | 'Kész' | 'Áll' | (string & {});
export type Season = 'Tavasz' | 'Nyár' | 'Ősz' | 'Tél' | 'Bármikor';
export type ShoppingCategory = 'Műhelyanyag' | 'Motoralkatrész';
export type ShoppingStatus = 'Beszerzendő' | 'Megrendelve' | 'Megérkezett';

export interface BikeTask {
  id: string;
  title: string;
  category: string;
  done: boolean;
  period?: string;
  season?: Season;
  guideId?: string;
  guidePointId?: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: string;
  category: ShoppingCategory;
  bikeId: string | null;
  status: ShoppingStatus;
  bought?: boolean;
}

export interface WorkshopTimer {
  id: string;
  bikeId: string | null;
  presetKey: string;
  startedAt: number;
  tempAtStart: number;
  customTitle?: string;
  customDurationMinutes?: number;
}

export interface WorkshopChemical {
  id: string;
  name: string;
  purpose: string;
  notes: string;
  timerMinutes?: number;
  sourceFile?: string;
}

export interface GuidePoint {
  id: string;
  text: string;
  isWarning: boolean;
  done: boolean;
}

export interface GuideStep {
  id: string;
  title: string;
  summary: string;
  category: string;
  points: GuidePoint[];
}

export interface AiGuide {
  id: string;
  title: string;
  subtitle: string;
  sourceFile: string;
  createdAt: string;
  steps: GuideStep[];
}

export interface BikeSpecification {
  id: string;
  label: string;
  value: string;
}

export interface BikePhoto {
  id: string;
  dataUrl?: string;
  date?: string;
  tag: string;
  comment: string;
  createdAt: string;
}

export interface BikeDocument {
  id: string;
  bikeId: string;
  guideId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  dataUrl?: string;
}

export interface Bike {
  id: string;
  name: string;
  year: number;
  status: BikeStatus;
  frameNumber: string;
  engineNumber: string;
  engineCode?: string;
  displacementCc?: string;
  power?: string;
  transmission?: string;
  fuel?: string;
  ignition?: string;
  specifications?: BikeSpecification[];
  photos?: BikePhoto[];
  tasks: BikeTask[];
  guides: AiGuide[];
}

export interface GarageData {
  bikes: Bike[];
  documents: BikeDocument[];
  activeBikeId: string;
  shoppingItems: ShoppingItem[];
  planningPeriods: string[];
  workshopTempC: number;
  workshopTimers: WorkshopTimer[];
  workshopChemicals: WorkshopChemical[];
}
