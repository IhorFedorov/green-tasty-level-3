import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { CardReservationComponent } from './card-reservation.component';
import { ReservationCustomer, ReservationStatusCustomer } from '@app/models/reservations/reservation.model';
import { Roles } from '@app/shared/constants/roles';

describe('Owner group navigation', () => {
  let navigate: jasmine.Spy;
  function create(role = Roles.CUSTOMER, guests = 4, status = ReservationStatusCustomer.Reserved) {
    const component = TestBed.runInInjectionContext(() => new CardReservationComponent());
    Object.assign(component, {
      role: signal(role),
      r: signal({ id: 'existing-reservation', guestCount: guests, status } as ReservationCustomer),
    });
    return component;
  }
  beforeEach(() => {
    navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { navigate } }] });
  });
  it('navigates to the existing reservation without creating a booking or order', () => {
    const component = create();
    expect(component.canOpenGroupPreOrder()).toBeTrue();
    component.onGroupPreOrder();
    expect(navigate).toHaveBeenCalledOnceWith(['/reservations', 'existing-reservation', 'group-order']);
  });
  it('does not expose Owner navigation to a Waiter', () => {
    const component = create(Roles.WAITER);
    expect(component.canOpenGroupPreOrder()).toBeFalse();
    component.onGroupPreOrder();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('does not navigate for a single-person reservation', () => {
    const component = create(Roles.CUSTOMER, 1);
    expect(component.canOpenGroupPreOrder()).toBeFalse();
    component.onGroupPreOrder();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('does not navigate for a cancelled reservation', () => {
    const component = create(Roles.CUSTOMER, 4, ReservationStatusCustomer.Cancelled);
    expect(component.canOpenGroupPreOrder()).toBeFalse();
    component.onGroupPreOrder();
    expect(navigate).not.toHaveBeenCalled();
  });
});
