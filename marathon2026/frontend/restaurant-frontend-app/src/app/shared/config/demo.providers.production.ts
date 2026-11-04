import { HttpInterceptorFn } from '@angular/common/http';
import { EnvironmentProviders, Provider } from '@angular/core';

// Replaces the development module at build time: no mock imports in production.
export const demoProviders: (Provider | EnvironmentProviders)[] = [];
export const demoInterceptors: HttpInterceptorFn[] = [];
