import { isDevMode, provideAppInitializer } from '@angular/core';
import { groupOrdersMockInterceptor } from '../mocks/group-orders/group-orders-mock.interceptor';
import { applyDemoLoginFromUrl } from '../mocks/auth/demo-auth';

export const demoProviders = [provideAppInitializer(() => {
  if (isDevMode()) applyDemoLoginFromUrl();
})];
export const demoInterceptors = isDevMode() ? [groupOrdersMockInterceptor] : [];
