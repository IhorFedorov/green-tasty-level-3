import { computed, Injectable, signal } from '@angular/core';
import { Order } from '@app/models/orders/order.model';

export interface CartReadScope { epoch: number; revision: number; }

/** UI-only counts. Never aggregates different reservations or stores credentials. */
@Injectable({ providedIn: 'root' })
export class CartQuantityService {
  private owner: string | null = null;
  private epoch = 0;
  private revision = 0;
  private loaded = false;
  private readonly carts = signal(new Map<string, { quantity: number; status: number }>());
  readonly reservationId = signal('');
  readonly quantity = computed(() => {
    const cart = this.carts().get(this.reservationId());
    return cart?.status === 0 ? cart.quantity : 0;
  });

  setOwner(owner: string | null): boolean {
    if (this.owner === owner) return false;
    this.owner = owner; this.epoch++; this.revision++;
    this.loaded = false;
    this.carts.set(new Map()); this.reservationId.set('');
    return true;
  }
  selectReservation(id: string): void { if (this.owner && id) this.reservationId.set(id); }
  scope(): CartReadScope { return { epoch: this.epoch, revision: this.revision }; }
  hasSnapshot(): boolean { return this.loaded; }
  replace(orders: Order[], scope: CartReadScope): void {
    if (!this.owner || scope.epoch !== this.epoch || scope.revision !== this.revision) return;
    const carts = new Map(orders.map(order => [order.reservationId, {
      quantity: order.orderItems.reduce((sum, item) => sum + item.quantity, 0), status: order.status,
    }]));
    this.carts.set(carts); this.revision++; this.loaded = true;
    if (!this.reservationId() && carts.size === 1) this.reservationId.set(carts.keys().next().value!);
  }
  update(id: string, quantity: number, status: number, scope: CartReadScope): void {
    if (!this.owner || scope.epoch !== this.epoch) return;
    const carts = new Map(this.carts()); carts.set(id, { quantity, status });
    this.carts.set(carts); this.revision++;
  }
  setStatus(id: string, status: number, scope: CartReadScope): void {
    if (!this.owner || scope.epoch !== this.epoch) return;
    this.update(id, this.carts().get(id)?.quantity ?? 0, status, scope);
  }
}
