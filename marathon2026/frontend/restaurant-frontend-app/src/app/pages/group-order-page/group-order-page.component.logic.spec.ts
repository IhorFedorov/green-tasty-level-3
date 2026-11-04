// No DOM: tests state and request lifecycle; does not replace template tests.
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { GroupOrderPageComponent } from './group-order-page.component';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';

describe('Owner Review request lifecycle (without DOM)', () => {
  let service: jasmine.SpyObj<GroupOrdersService>;
  let toast: jasmine.SpyObj<ToastService>;
  const snapshot: GroupSessionsResponse = { participants: [
    { id: 'owner', name: 'Owner', type: 'Owner', total: 180, isSubmitted: true, items: [{ dish: { id: 'dish', name: 'Salad', price: 180 }, quantity: 1 }] },
    { id: 'guest', name: 'Guest', type: 'Guest', total: 360, isSubmitted: true, items: [{ dish: { id: 'dish', name: 'Salad', price: 180 }, quantity: 2 }] },
    { id: 'draft', name: 'Draft', type: 'Guest', total: 220, isSubmitted: false, items: [{ dish: { id: 'other', name: 'Soup', price: 220 }, quantity: 1 }] },
  ], total: 760 };
  beforeEach(() => {
    service = jasmine.createSpyObj('GroupOrdersService', ['getGroupInvite$', 'getSessions$', 'getOwnerSessionId$', 'getStatus$', 'submit$']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    service.getGroupInvite$.and.returnValue(of({ GroupReservationId: 'group' } as GuestInvite));
    service.getOwnerSessionId$.and.returnValue(of('owner'));
    service.getSessions$.and.returnValue(of(structuredClone(snapshot)));
    service.getStatus$.and.returnValue(of({ status: 'Open', currentParticipants: 3, maxCapacity: 5 }));
    TestBed.configureTestingModule({ providers: [
      { provide: GroupOrdersService, useValue: service }, { provide: ToastService, useValue: toast },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ reservationId: 'reservation' }) } } },
    ] });
  });
  afterEach(() => TestBed.resetTestingModule());
  const scenario = (run: () => void) => fakeAsync(() => { try { run(); } finally { TestBed.resetTestingModule(); } });
  const create = () => TestBed.runInInjectionContext(() => new GroupOrderPageComponent());

  it('uses only submitted dishes: 540 instead of API total 760', scenario(() => {
    const page = create();
    expect(page.consolidated().total).toBe(540);
    expect(page.consolidated().items[0].quantity).toBe(3);
    expect(page.ownerSessionId()).toBe('owner');
  }));
  it('waits for Owner ensure before enumerating sessions', scenario(() => {
    const owner = new Subject<string>(); service.getOwnerSessionId$.and.returnValue(owner);
    const page = create(); expect(page.loading()).toBeTrue(); expect(service.getSessions$).not.toHaveBeenCalled();
    owner.next('owner'); owner.complete(); expect(service.getSessions$).toHaveBeenCalledTimes(1);
  }));
  it('does not overlap manual refresh and polling', scenario(() => {
    const page = create(); const pending = new Subject<GroupSessionsResponse>();
    service.getSessions$.and.returnValue(pending); page.refresh(); tick(45_000);
    expect(service.getSessions$).toHaveBeenCalledTimes(2);
    pending.next(snapshot); pending.complete(); tick(15_000);
    expect(service.getSessions$).toHaveBeenCalledTimes(3);
  }));
  it('reload keeps only one polling timer', scenario(() => {
    const page = create(); page.load(); tick(15_000);
    expect(service.getSessions$).toHaveBeenCalledTimes(3);
  }));
  it('failed refresh preserves last data and timestamp', scenario(() => {
    const page = create(); const previous = page.updatedAt();
    service.getSessions$.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    tick(15_000);
    expect(page.participants().length).toBe(3); expect(page.updatedAt()).toBe(previous); expect(page.refreshFailed()).toBeTrue();
  }));
  it('guards duplicate Submit and stops polling after success', scenario(() => {
    const response = new Subject<{ dishId: string; quantity: number }[]>(); service.submit$.and.returnValue(response);
    const page = create(); page.confirmSubmit.set(true); page.submit(); page.submit();
    expect(service.submit$).toHaveBeenCalledOnceWith('group', 'reservation');
    response.next([{ dishId: 'dish', quantity: 3 }]); response.complete(); tick(45_000);
    expect(page.open()).toBeFalse(); expect(service.getSessions$).toHaveBeenCalledTimes(1); expect(toast.success).toHaveBeenCalledTimes(1);
  }));
  it('Submit failure allows retry and does not duplicate interceptor toast', scenario(() => {
    service.submit$.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    const page = create(); page.confirmSubmit.set(true); page.submit();
    expect(page.canSubmit()).toBeTrue(); expect(toast.error).not.toHaveBeenCalled();
    page.confirmSubmit.set(true); page.submit(); expect(service.submit$).toHaveBeenCalledTimes(2);
  }));
  it('external Closed status stops synchronization', scenario(() => {
    const page = create(); service.getStatus$.and.returnValue(of({ status: 'Closed', currentParticipants: 3, maxCapacity: 5 }));
    tick(45_000); expect(page.open()).toBeFalse(); expect(service.getSessions$).toHaveBeenCalledTimes(2);
  }));
  it('destroy cancels an in-flight refresh and timer', scenario(() => {
    const page = create(); const pending = new Subject<GroupSessionsResponse>(); service.getSessions$.and.returnValue(pending);
    page.refresh(); TestBed.resetTestingModule(); expect(pending.observed).toBeFalse();
    tick(45_000); expect(service.getSessions$).toHaveBeenCalledTimes(2);
  }));
  it('404 stays recoverable through load', scenario(() => {
    service.getGroupInvite$.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const page = create(); expect(page.error()).toBe('Group reservation not found'); expect(page.loading()).toBeFalse();
    service.getGroupInvite$.and.returnValue(of({ GroupReservationId: 'group' } as GuestInvite)); page.load(); expect(page.error()).toBe('');
  }));
});
