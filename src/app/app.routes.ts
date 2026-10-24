import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'satnik' },
  {
    path: 'satnik',
    title: 'Šatník',
    loadComponent: () => import('./features/wardrobe/wardrobe-page').then((m) => m.WardrobePage),
  },
  {
    path: 'vyzkouset',
    title: 'Vyzkoušet',
    loadComponent: () => import('./features/try-on/try-on-page').then((m) => m.TryOnPage),
  },
  {
    path: 'outfity',
    title: 'Outfity',
    loadComponent: () => import('./features/outfits/outfits-page').then((m) => m.OutfitsPage),
  },
  {
    path: 'pridat',
    title: 'Nový kus',
    loadComponent: () => import('./features/add-item/add-item-page').then((m) => m.AddItemPage),
  },
  { path: '**', redirectTo: 'satnik' },
];
