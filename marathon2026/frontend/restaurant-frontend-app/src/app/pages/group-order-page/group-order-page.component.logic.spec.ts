// No DOM: tests state and request lifecycle; does not replace template tests.
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
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
  let clipboard: jasmine.Spy;
  const snapshot: GroupSessionsResponse = { participants: [
    { id: 'owner', name: 'Owner', type: 'Owner', total: 180, isSubmitted: true, items: [{ dish: { id: 'dish', name: 'Salad', price: 180 }, quantity: 1 }] },
    { id: 'guest', name: 'Guest', type: 'Guest', total: 360, isSubmitted: true, items: [{ dish: { id: 'dish', name: 'Salad', price: 180 }, quantity: 2 }] },
    { id: 'draft', name: 'Draft', type: 'Guest', total: 220, isSubmitted: false, items: [{ dish: { id: 'other', name: 'Soup', price: 220 }, quantity: 1 }] },
  ], total: 760 };
  beforeEach(() => {
    service = jasmine.createSpyObj('GroupOrdersService', ['getOwnerState$', 'getGroupInvite$', 'getSessions$', 'getOwnerSessionId$', 'getStatus$', 'submit$']);
    service.getOwnerState$.and.returnValue(of({ status: 'Open', groupReservationId: 'group' } as any));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    clipboard = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    service.getGroupInvite$.and.returnValue(of({ GroupReservationId: 'group', invitationPath: '/join/invitation-A' } as GuestInvite));
    service.getOwnerSessionId$.and.returnValue(of('owner'));
    service.getSessions$.and.returnValue(of(structuredClone(snapshot)));
    service.getStatus$.and.returnValue(of({ status: 'Open', currentParticipants: 3, maxCapacity: 5 }));
    TestBed.configureTestingModule({ providers: [
      { provide: GroupOrdersService, useValue: service }, { provide: ToastService, useValue: toast },
      { provide: DOCUMENT, useValue: { location: { origin: 'https://app.test' }, defaultView: { navigator: { clipboard: { writeText: clipboard } } } } },
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
  it('reopens and copies the same existing invitation without API/ensure/submit calls', async () => {
    const page = create();
    const requests = [service.getGroupInvite$.calls.count(), service.getOwnerSessionId$.calls.count(), service.getSessions$.calls.count()];
    page.showInvite(); expect(page.inviteDialog()).toBeTrue();
    await page.copyInviteLink();
    expect(clipboard).toHaveBeenCalledOnceWith('https://app.test/join/invitation-A');
    page.inviteDialog.set(false); page.showInvite();
    expect(page.inviteLink()).toBe('https://app.test/join/invitation-A');
    expect([service.getGroupInvite$.calls.count(), service.getOwnerSessionId$.calls.count(), service.getSessions$.calls.count()]).toEqual(requests);
    expect(service.submit$).not.toHaveBeenCalled();
  });
  it('clipboard denial retains the visible link for manual copy without false success', async () => {
    clipboard.and.callFake(() => Promise.reject(new Error('Denied')));
    const page = create(); page.showInvite(); await page.copyInviteLink();
    expect(page.inviteDialog()).toBeTrue(); expect(page.inviteLink()).not.toBe('');
    expect(page.copyingInvite()).toBeFalse(); expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('rejects an invitation for another group before any Owner ensure', scenario(() => {
    service.getGroupInvite$.and.returnValue(of({ GroupReservationId: 'other', invitationPath: '/join/other' } as GuestInvite));
    const page = create(); page.showInvite();
    expect(page.error()).not.toBe(''); expect(page.inviteDialog()).toBeFalse();
    expect(service.getOwnerSessionId$).not.toHaveBeenCalled(); expect(service.getSessions$).not.toHaveBeenCalled();
  }));
  function submitted() {
    service.getOwnerState$.and.returnValue(of({ groupReservationId: 'group', status: 'Submitted', guestSessionId: 'owner',
      startTime: '2026-11-05T14:15:00Z', endTime: '2026-11-05T15:45:00Z', maxGuestCount: 4, locationAddress: 'Demo location',
      submittedItems: [{ dishId: 'bowl', quantity: 3 }, { dishId: 'salad', quantity: 3 }] }));
    service.getStatus$.and.returnValue(of({ status: 'Submitted', currentParticipants: 3, maxCapacity: 4 }));
    service.getSessions$.and.returnValue(of({ total: 999, participants: [
      { id: 'owner', name: 'Owner', type: 'Owner', isSubmitted: false, total: 0, items: [] },
      { id: 'a', name: 'A', type: 'Guest', isSubmitted: true, total: 26, items: [
        { dish: { id: 'bowl', name: 'Bowl', price: 10 }, quantity: 2 }, { dish: { id: 'salad', name: 'Salad', price: 6 }, quantity: 1 }] },
      { id: 'b', name: 'B', type: 'Guest', isSubmitted: true, total: 22, items: [
        { dish: { id: 'bowl', name: 'Bowl', price: 10 }, quantity: 1 }, { dish: { id: 'salad', name: 'Salad', price: 6 }, quantity: 2 }] },
    ] }));
  }
  it('Submitted reload/new instance reads persisted 3+3/48 without invite or ensure and never polls/submits', scenario(() => {
    submitted();
    const page = create(); page.load(); const newTab = create();
    for (const view of [page, newTab]) {
      expect(view.error()).toBe(''); expect(view.groupStatus()?.status).toBe('Submitted');
      expect(view.consolidated().items.map(item => item.quantity)).toEqual([3, 3]);
      expect(view.consolidated().total).toBe(48); expect(view.canSubmit()).toBeFalse();
      view.showInvite(); void view.copyInviteLink(); expect(view.inviteDialog()).toBeFalse(); expect(view.inviteLink()).toBe('');
      view.confirmSubmit.set(true); view.submit(); view.refresh();
    }
    tick(45_000);
    expect(service.getOwnerState$).toHaveBeenCalledTimes(3);
    expect(service.getSessions$).toHaveBeenCalledTimes(3);
    expect(service.getGroupInvite$).not.toHaveBeenCalled(); expect(service.getOwnerSessionId$).not.toHaveBeenCalled();
    expect(service.submit$).not.toHaveBeenCalled();
    expect(clipboard).not.toHaveBeenCalled();
  }));
  it('Submitted view uses persisted quantities rather than later session quantity changes', scenario(() => {
    submitted();
    const data = { participants: [{ id: 'a', name: 'A', type: 'Guest' as const, total: 1000, isSubmitted: true, items: [
      { dish: { id: 'bowl', name: 'Bowl', price: 10 }, quantity: 100 }, { dish: { id: 'salad', name: 'Salad', price: 6 }, quantity: 100 }] }], total: 1600 };
    service.getSessions$.and.returnValue(of(data));
    expect(create().consolidated().total).toBe(48);
  }));
  for (const status of [401, 403]) it(`Owner state ${status} does not load invitation or participant data`, scenario(() => {
    service.getOwnerState$.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
    const page = create(); expect(page.error()).not.toBe('');
    expect(service.getGroupInvite$).not.toHaveBeenCalled(); expect(service.getSessions$).not.toHaveBeenCalled();
    expect(service.getOwnerSessionId$).not.toHaveBeenCalled();
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
