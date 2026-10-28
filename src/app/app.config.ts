import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { AvatarStore } from './core/avatar.store';
import { FitService } from './core/fit.service';
import { OutfitStore } from './core/outfit.store';
import { WardrobeStore } from './core/wardrobe.store';
import { CLOTHING_TRANSFORMER } from './ai/clothing-transformer';
import { PassthroughTransformer } from './ai/passthrough-transformer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // Výměnou tohoto provideru se napojí skutečná AI (viz README → „Napojení AI“).
    { provide: CLOTHING_TRANSFORMER, useClass: PassthroughTransformer },
    provideAppInitializer(async () => {
      const wardrobe = inject(WardrobeStore);
      const outfit = inject(OutfitStore);
      const avatar = inject(AvatarStore);
      const fit = inject(FitService);
      const [seeded] = await Promise.all([wardrobe.init(), avatar.init()]);
      await outfit.init(seeded);
      // Automatický přepočet uložených kusů po změně pravidel výřezu je vypnutý – hotový kus se sám nemění
      // (dřív se tím zhoršily kusy, které seděly). Přepočet jen na vyžádání: fit.upgradeAll().
      void fit;
    }),
  ],
};
