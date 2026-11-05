import { TestBed } from '@angular/core/testing';
import { RendererFactory2 } from '@angular/core';
import { of, Subject } from 'rxjs';
import { GuestPreorderStore } from './guest-preorder.store';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { GuestSessionsService } from '@app/services/guest-sessions/guest-sessions.service';
import { CartQuantityService } from '@app/services/pre-orders/cart-quantity.service';

describe('Guest cart unit count and context isolation', () => {
  let store: GuestPreorderStore; let api: jasmine.SpyObj<GuestSessionsService>;
  let storage: Map<string, string>; let original: PropertyDescriptor | undefined;
  const bowl = { dishId: 'bowl', title: 'Bowl', price: 10 };
  beforeEach(() => {
    storage = new Map(); original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    } });
    api = jasmine.createSpyObj('GuestSessionsService', ['getMenu', 'addDish', 'removeDish', 'submit', 'createSession']);
    api.getMenu.and.returnValue(of({ dishes: {} })); api.addDish.and.returnValue(of({})); api.removeDish.and.returnValue(of({}));
    TestBed.configureTestingModule({ providers: [
      // Only flush root-store persistence effects; these tests never render a view.
      { provide: RendererFactory2, useValue: { createRenderer: () => ({ destroy() {} }) } },
      { provide: GuestSessionsService, useValue: api },
      { provide: GuestInviteService, useValue: { getInvite$: () => of({ GroupReservationId: 'group' }) } },
    ] });
    store = TestBed.inject(GuestPreorderStore);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete (globalThis as any).localStorage;
  });
  async function contextA() {
    store.initContext('inviteA'); await Promise.resolve();
    store.guestSessionId.set('sessionA'); store.guestSessionToken.set('synthetic-test-token');
    store.cartItems.set([{ ...bowl, qty: 2 }, { dishId: 'salad', title: 'Salad', price: 6, qty: 3 }]);
    TestBed.tick();
  }
  it('counts units through add/increment/decrement/remove, without mixing the Owner counter', async () => {
    await contextA();
    const owner = TestBed.inject(CartQuantityService); owner.setOwner('owner'); owner.selectReservation('ownerReservation'); owner.update('ownerReservation', 20, 0, owner.scope());
    expect(store.itemCount()).toBe(5);
    await store.addDish(bowl); expect(store.itemCount()).toBe(6);
    await store.inc('bowl'); expect(store.itemCount()).toBe(7);
    await store.dec('bowl'); expect(store.itemCount()).toBe(6);
    await store.remove('salad'); expect(store.itemCount()).toBe(3);
    expect(owner.quantity()).toBe(20); expect(api.submit).not.toHaveBeenCalled();
  });
  it('restores the same guest cart and starts a different invite empty, with no session creation', async () => {
    await contextA(); expect(store.itemCount()).toBe(5);
    store.initContext('inviteB'); await Promise.resolve(); TestBed.tick();
    expect(store.itemCount()).toBe(0); expect(store.guestSessionId()).toBeNull();
    store.initContext('inviteA'); await Promise.resolve();
    expect(store.itemCount()).toBe(5); expect(store.guestSessionId()).toBe('sessionA');
    api.createSession.and.stub(); expect(api.createSession).not.toHaveBeenCalled();
  });
  it('a delayed cart success for A does not change B and is retained when A returns', async () => {
    await contextA(); const delayed = new Subject<object>(); api.addDish.and.returnValue(delayed);
    const pending = store.inc('bowl'); store.initContext('inviteB'); await Promise.resolve(); TestBed.tick();
    delayed.next({}); delayed.complete(); await pending;
    expect(store.itemCount()).toBe(0);
    store.initContext('inviteA'); await Promise.resolve(); expect(store.itemCount()).toBe(6);
  });
  it('failed guest mutation does not change confirmed count', async () => {
    await contextA(); const delayed = new Subject<object>(); api.addDish.and.returnValue(delayed);
    const pending = store.inc('bowl'); delayed.error(new Error('Synthetic failure')); await pending;
    expect(store.itemCount()).toBe(5);
  });
  it('returning to A while its Submit is pending keeps it busy and prevents repeat Submit or edits', async () => {
    await contextA(); const delayed = new Subject<object>(); api.submit.and.returnValue(delayed);
    const pending = store.submitPreorder(); store.initContext('inviteB'); await Promise.resolve(); TestBed.tick();
    store.initContext('inviteA'); await Promise.resolve(); expect(store.cartBusy()).toBeTrue();
    await store.inc('bowl'); await store.submitPreorder();
    expect(api.addDish).not.toHaveBeenCalled(); expect(api.submit).toHaveBeenCalledTimes(1);
    delayed.next({}); delayed.complete(); await pending;
    expect(store.status()).toBe('submitted'); expect(store.itemCount()).toBe(5); expect(store.cartBusy()).toBeFalse();
  });
  it('a completed Submit for A does not affect B and A returns with its own submitted cart', async () => {
    await contextA(); const delayed = new Subject<object>(); api.submit.and.returnValue(delayed);
    const pending = store.submitPreorder(); store.initContext('inviteB'); await Promise.resolve(); TestBed.tick();
    delayed.next({}); delayed.complete(); await pending;
    expect(store.status()).toBe('active'); expect(store.itemCount()).toBe(0);
    store.initContext('inviteA'); await Promise.resolve();
    expect(store.status()).toBe('submitted'); expect(store.itemCount()).toBe(5);
    await store.inc('bowl'); await store.submitPreorder();
    expect(api.addDish).not.toHaveBeenCalled(); expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it('a new guest session on the same invitation starts at zero instead of inheriting the first guest cart', async () => {
    await contextA(); store.setGuestName('Synthetic guest');
    api.createSession.and.returnValue(of({ SessionId: 'sessionB', SessionToken: 'synthetic-B' }));
    await store.createNewPreorder();
    expect(store.guestSessionId()).toBe('sessionB'); expect(store.itemCount()).toBe(0);
    expect(api.submit).not.toHaveBeenCalled();
  });
});
