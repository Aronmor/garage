import type { GarageData, Season } from './types';

export const DEFAULT_PLANNING_PERIODS: Season[] = ['Tavasz', 'Nyár', 'Ősz', 'Tél', 'Bármikor'];

export const initialGarage: GarageData = {
  activeBikeId: 'jawa-350-634',
  documents: [],
  shoppingItems: [],
  planningPeriods: DEFAULT_PLANNING_PERIODS,
  workshopTempC: 18,
  workshopTimers: [],
  workshopChemicals: [],
  bikes: [
    {
      id: 'jawa-350-634',
      name: 'Jawa 350 634',
      year: 1982,
      status: 'Folyamatban',
      frameNumber: '',
      engineNumber: '',
      guides: [],
      tasks: [
        { id: 'jawa-task-1', title: 'Karburátor felújítása', category: 'Blokk & karburátor', done: false },
        { id: 'jawa-task-2', title: 'Elektromos rendszer átvizsgálása', category: 'Elektromosság', done: false },
        { id: 'jawa-task-3', title: 'Fékek szétszerelése és ellenőrzése', category: 'Futómű & fékek', done: true },
        { id: 'jawa-task-4', title: 'Tank belső rozsdátlanítása', category: 'Tank & üzemanyag', done: false },
      ],
    },
    {
      id: 'simson-s51',
      name: 'Simson S51 Enduro',
      year: 1987,
      status: 'Kész',
      frameNumber: '',
      engineNumber: '',
      guides: [],
      tasks: [
        { id: 'simson-task-1', title: 'Gyújtás beállítása', category: 'Elektromosság', done: true },
        { id: 'simson-task-2', title: 'Karburátor ultrahangos tisztítása', category: 'Blokk & karburátor', done: true },
      ],
    },
  ],
};

export const STORAGE_KEY = 'muhelygarazs_react_v2';
export const LEGACY_STORAGE_KEY = 'muhelygarazs_react_v1';
