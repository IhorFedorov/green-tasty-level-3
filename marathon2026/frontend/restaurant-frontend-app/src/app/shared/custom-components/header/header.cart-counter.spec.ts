import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { DefaultUrlSerializer, NavigationEnd, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HeaderComponent } from './header.component';
import { AuthenticationService } from '@app/auth/services/authentication.service';
import { NotificationsService } from '@app/services/notifications/notifications.service';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { Roles } from '@app/shared/constants/roles';

describe('Header cart counter lifetime and navigation (no DOM)', () => {
  let header: HeaderComponent; let http: HttpTestingController;
  let users: BehaviorSubject<any>; let events: Subject<NavigationEnd>; let router: any;
  beforeEach(() => {
    users = new BehaviorSubject({ id: 'customer-A', role: Roles.CUSTOMER }); events = new Subject();
    router = { url: '/menu?preOrder=true&reservationId=r1', events,
      parseUrl: (url: string) => new DefaultUrlSerializer().parse(url) };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: API_BASE_URL, useValue: 'https://api.test' }, { provide: Router, useValue: router },
      { provide: AuthenticationService, useValue: { user$: users } },
      { provide: NotificationsService, useValue: { loadNotifications: () => of([]) } },
    ] });
    http = TestBed.inject(HttpTestingController);
    header = TestBed.runInInjectionContext(() => new HeaderComponent()); header.ngOnInit();
  });
  afterEach(() => { header.ngOnDestroy(); http.verify(); TestBed.resetTestingModule(); });
  it('badge survives cart close/open and navigation; another reservation uses its own count', () => {
    http.expectOne('https://api.test/orders').flush([
      { reservationId: 'r1', status: 0, orderItems: [{ quantity: 3 }] },
      { reservationId: 'r2', status: 0, orderItems: [{ quantity: 7 }] },
    ]);
    expect(header.cartQuantities.quantity()).toBe(3);
    header.toggleCart(); header.toggleCart(); expect(header.cartQuantities.quantity()).toBe(3);
    router.url = '/menu?reservationId=r2'; events.next(new NavigationEnd(1, router.url, router.url));
    expect(header.cartQuantities.quantity()).toBe(7);
    router.url = '/reservations/r1/group-order'; events.next(new NavigationEnd(2, router.url, router.url));
    expect(header.cartQuantities.quantity()).toBe(3);
    router.url = '/main'; events.next(new NavigationEnd(3, router.url, router.url));
    expect(header.cartQuantities.quantity()).toBe(3);
  });
  it('user switch cancels the old load, clears the badge, and loads only the new Customer', () => {
    const old = http.expectOne('https://api.test/orders');
    users.next({ id: 'customer-B', role: Roles.CUSTOMER }); expect(old.cancelled).toBeTrue();
    expect(header.cartQuantities.quantity()).toBe(0);
    http.expectOne('https://api.test/orders').flush([{ reservationId: 'r1', status: 0, orderItems: [{ quantity: 2 }] }]);
    expect(header.cartQuantities.quantity()).toBe(2);
    users.next(null); expect(header.cartQuantities.quantity()).toBe(0);
  });
});
