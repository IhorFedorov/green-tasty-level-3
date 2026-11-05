import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { Order } from '@app/models/orders/order.model';
import { DishListResponse } from '@app/models/dishes/dish-list-response.model';
import { defer, map, switchMap, tap } from 'rxjs';
import { CartQuantityService } from './cart-quantity.service';
import { CreateOrderRequest } from '@app/models/cart/create-order-request.model';

@Injectable({
  providedIn: 'root',
})
export class PreOrdersService {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly http = inject(HttpClient);
  private readonly quantities = inject(CartQuantityService);

  getPreOrders() {
    return defer(() => {
      const scope = this.quantities.scope();
      return this.http.get<Order[]>(`${this.baseUrl}/orders`).pipe(tap(orders => this.quantities.replace(orders, scope)));
    });
  }

  getByReservationId(reservationId: string) {
    return this.http.get<Order>(`${this.baseUrl}/orders/${reservationId}`);
  }

  addDishToPreOrderByReservationId(
    reservationId: string,
    dish: DishListResponse,
    quantity: number
  ) {
    this.quantities.selectReservation(reservationId);
    return this.getPreOrders().pipe(
      map((orders) => {
        const order = orders.find((o) => o.reservationId === reservationId);
        if (!order) {
          return order;
        }

        const existingItem = order.orderItems.find((item) => item.dish.id === dish.id);
        if (existingItem) {
          existingItem.quantity += quantity;
        } else {
          order.orderItems.push({ dish, quantity, state: 0 });
        }
        return order;
      }),
      switchMap((order) => {
        if (!order) {
          const orderCreateRequest: CreateOrderRequest = {
            reservationId,
            orderItems: [{ dish, quantity, state: 0 }],
          };
          return this.createPreOrder(orderCreateRequest);
        }

        return this.editPreOrderByReservationId(reservationId, order);
      })
    );
  }

  createPreOrder(order: CreateOrderRequest) {
    const createOrderRequest = {
      reservationId: order.reservationId,
      orderItems: order.orderItems.map((item) => ({
        dishId: item.dish.id,
        quantity: item.quantity,
      })),
    };

    return defer(() => {
      const scope = this.quantities.scope();
      return this.http.post<Order>(`${this.baseUrl}/orders`, createOrderRequest).pipe(tap(result =>
        this.quantities.update(order.reservationId, order.orderItems.reduce((sum, item) => sum + item.quantity, 0), result.status, scope)));
    });
  }

  editPreOrderByReservationId(reservationId: string, order: Order) {
    const orderItems = order.orderItems.map((item) => ({
      dishId: item.dish.id,
      quantity: item.quantity,
    }));

    if (orderItems.length === 0) {
      return this.cancelPreOrderByReservationId(reservationId);
    }

    return defer(() => {
      const scope = this.quantities.scope();
      return this.http.put(`${this.baseUrl}/orders/${reservationId}`, { orderItems }).pipe(tap(() =>
        this.quantities.update(reservationId, order.orderItems.reduce((sum, item) => sum + item.quantity, 0), order.status, scope)));
    });
  }

  cancelPreOrderByReservationId(reservationId: string) {
    return defer(() => {
      const scope = this.quantities.scope();
      return this.http.delete(`${this.baseUrl}/orders/${reservationId}`).pipe(tap(() => this.quantities.setStatus(reservationId, 2, scope)));
    });
  }

  submitPreOrderByReservationId(reservationId: string) {
    return defer(() => {
      const scope = this.quantities.scope();
      return this.http.post(`${this.baseUrl}/orders/${reservationId}/submit`, {}).pipe(tap(() => this.quantities.setStatus(reservationId, 1, scope)));
    });
  }

  unsubmitPreOrderByReservationId(reservationId: string) {
    return defer(() => {
      const scope = this.quantities.scope();
      return this.http.post(`${this.baseUrl}/orders/${reservationId}/unsubmit`, {}).pipe(tap(() => this.quantities.setStatus(reservationId, 0, scope)));
    });
  }

  confirmDishInOrder(reservationId: string, dishId: string) {
    return this.http.patch(
      `${this.baseUrl}/reservations/${reservationId}/order/confirmations/${dishId}`,
      {}
    );
  }

  rejectDishInOrder(reservationId: string, dishId: string) {
    return this.http.patch(
      `${this.baseUrl}/reservations/${reservationId}/order/cancellations/${dishId}`,
      {}
    );
  }
}
