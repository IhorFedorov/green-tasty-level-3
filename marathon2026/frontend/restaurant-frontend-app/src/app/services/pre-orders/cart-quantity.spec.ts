import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CartQuantityService } from './cart-quantity.service';
import { PreOrdersService } from './pre-orders.service';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { Order } from '@app/models/orders/order.model';

const dish = { id: 'bowl', name: 'Bowl', price: 10 } as any;
const order = (reservationId: string, quantities: number[], status = 0): Order => ({
  orderId: `o-${reservationId}`, reservationId, reservationAddress: '', reservationTime: '', status,
  orderItems: quantities.map((quantity, index) => ({ dish: { ...dish, id: `d${index}` }, quantity, state: 0 })),
});
describe('Owner cart quantity, scoped to user and reservation', () => {
  let counts: CartQuantityService; let service: PreOrdersService; let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE_URL, useValue: 'https://api.test' }] });
    counts = TestBed.inject(CartQuantityService); service = TestBed.inject(PreOrdersService); http = TestBed.inject(HttpTestingController);
    counts.setOwner('owner-A'); counts.selectReservation('r1');
  });
  afterEach(() => http.verify());
  it('counts units, keeps reservation counts separate and survives navigation/return', () => {
    counts.replace([order('r1', [2, 3]), order('r2', [7])], counts.scope());
    expect(counts.quantity()).toBe(5);
    counts.selectReservation('r2'); expect(counts.quantity()).toBe(7);
    counts.selectReservation('r1'); expect(counts.quantity()).toBe(5);
    expect(counts.setOwner('owner-A')).toBeFalse(); expect(counts.quantity()).toBe(5);
    counts.setOwner(null); counts.setOwner('owner-B'); counts.selectReservation('r1'); expect(counts.quantity()).toBe(0);
  });
  it('does not count submitted/cancelled orders as draft cart units', () => {
    counts.replace([order('r1', [3], 3), order('r2', [8], 1), order('r3', [10], 2)], counts.scope());
    for (const id of ['r1', 'r2', 'r3']) { counts.selectReservation(id); expect(counts.quantity()).toBe(0); }
  });
  it('updates after successful create only, without adding new HTTP calls', () => {
    service.addDishToPreOrderByReservationId('r1', dish, 1).subscribe();
    http.expectOne('https://api.test/orders').flush([]);
    const create = http.expectOne('https://api.test/orders'); expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ reservationId: 'r1', orderItems: [{ dishId: 'bowl', quantity: 1 }] });
    expect(counts.quantity()).toBe(0);
    create.flush({ ...order('r1', [1]), orderItems: [{ dish, quantity: 1, state: 0 }] });
    expect(counts.quantity()).toBe(1);
  });
  it('updates quantity/removal only on success, and cancel clears the counter', () => {
    counts.replace([order('r1', [2, 3])], counts.scope());
    service.editPreOrderByReservationId('r1', order('r1', [4, 3])).subscribe();
    expect(counts.quantity()).toBe(5); http.expectOne('https://api.test/orders/r1').flush({}); expect(counts.quantity()).toBe(7);
    service.editPreOrderByReservationId('r1', order('r1', [4])).subscribe();
    http.expectOne('https://api.test/orders/r1').flush({}); expect(counts.quantity()).toBe(4);
    service.editPreOrderByReservationId('r1', order('r1', [])).subscribe();
    const remove = http.expectOne('https://api.test/orders/r1'); expect(remove.request.method).toBe('DELETE'); remove.flush({});
    expect(counts.quantity()).toBe(0);
  });
  it('failed update preserves confirmed quantity', () => {
    counts.replace([order('r1', [2])], counts.scope());
    service.editPreOrderByReservationId('r1', order('r1', [9])).subscribe({ error: () => {} });
    http.expectOne('https://api.test/orders/r1').flush({}, { status: 400, statusText: 'Rejected' });
    expect(counts.quantity()).toBe(2);
  });
  it('submit/unsubmit request contracts stay unchanged', () => {
    counts.replace([order('r1', [2])], counts.scope());
    service.submitPreOrderByReservationId('r1').subscribe();
    const submit = http.expectOne('https://api.test/orders/r1/submit'); expect(submit.request.body).toEqual({}); submit.flush({});
    expect(counts.quantity()).toBe(0);
    service.unsubmitPreOrderByReservationId('r1').subscribe();
    http.expectOne('https://api.test/orders/r1/unsubmit').flush({}); expect(counts.quantity()).toBe(2);
  });
  it('successful Group Submit clears only the selected reservation draft badge, not its business request', () => {
    counts.replace([order('r1', [1]), order('r2', [8])], counts.scope());
    TestBed.inject(GroupOrdersService).submit$('g1', 'r1').subscribe();
    const req = http.expectOne('https://api.test/group-reservations/g1/submit');
    expect(req.request.body).toEqual({ reservationId: 'r1' });
    expect(counts.quantity()).toBe(1); req.flush([{ dishId: 'bowl', quantity: 3 }]);
    expect(counts.quantity()).toBe(0); counts.selectReservation('r2'); expect(counts.quantity()).toBe(8);
  });
  it('ignores delayed responses from a previous login, including logout/login of the same user', () => {
    service.getPreOrders().subscribe(); const pending = http.expectOne('https://api.test/orders');
    counts.setOwner(null); counts.setOwner('owner-A'); counts.selectReservation('r1');
    pending.flush([order('r1', [99])]); expect(counts.quantity()).toBe(0);
  });
  it('ignores a stale read after a confirmed mutation and does not switch active reservation', () => {
    service.getPreOrders().subscribe(); const pending = http.expectOne('https://api.test/orders');
    counts.update('r1', 3, 0, counts.scope()); counts.selectReservation('r2');
    pending.flush([order('r1', [1]), order('r2', [100])]);
    expect(counts.quantity()).toBe(0); counts.selectReservation('r1'); expect(counts.quantity()).toBe(3);
  });
});
