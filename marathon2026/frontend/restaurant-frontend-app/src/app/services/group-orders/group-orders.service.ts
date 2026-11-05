import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, map, switchMap, tap } from 'rxjs';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { SKIP_ERROR_TOAST } from '@app/auth/skip-error-toast.context';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';
import { OwnerGroupState, OwnerSessionResponse } from '@app/models/group-orders/owner-session.model';
import { SubmittedDish } from '@app/models/group-orders/submit-group-pre-order.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { CartQuantityService } from '@app/services/pre-orders/cart-quantity.service';

@Injectable({ providedIn: 'root' })
export class GroupOrdersService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);
  private readonly invites = inject(GuestInviteService);
  private readonly cartQuantities = inject(CartQuantityService);
  getOwnerState$(reservationId: string) {
    return this.http.get<OwnerGroupState>(`${this.base}/reservations/${encodeURIComponent(reservationId)}/guest-session-id`, {
      params: { view: 'state' },
    });
  }
  getGroupInvite$(reservationId: string): Observable<GuestInvite> {
    return this.invites.getInviteToken$(reservationId).pipe(
      switchMap(({ token }) => this.invites.getInvite$(token).pipe(
        map(invite => ({ ...invite, invitationPath: `/join/${encodeURIComponent(token)}` })),
      )),
    );
  }
  getSessions$(groupId: string, options: { silent?: boolean } = {}) {
    return this.http.get<GroupSessionsResponse>(`${this.base}/guest/groups/${encodeURIComponent(groupId)}/sessions`, {
      context: new HttpContext().set(SKIP_ERROR_TOAST, !!options.silent),
    });
  }
  getOwnerSessionId$(reservationId: string) {
    return this.http.get<OwnerSessionResponse>(`${this.base}/reservations/${encodeURIComponent(reservationId)}/guest-session-id`).pipe(map(response => response.guestSessionId));
  }
  getStatus$(groupId: string, options: { silent?: boolean } = {}) {
    return this.http.get<GroupStatusResponse>(`${this.base}/guest/groups/${encodeURIComponent(groupId)}/status`, {
      context: new HttpContext().set(SKIP_ERROR_TOAST, !!options.silent),
    });
  }
  submit$(groupId: string, reservationId: string) {
    const scope = this.cartQuantities.scope();
    return this.http.post<SubmittedDish[]>(`${this.base}/group-reservations/${encodeURIComponent(groupId)}/submit`, { reservationId }).pipe(
      tap(() => this.cartQuantities.setStatus(reservationId, 3, scope)),
    );
  }
  removeSession$(groupId: string, sessionId: string) {
    return this.http.delete<GroupSessionsResponse>(`${this.base}/guest/groups/${encodeURIComponent(groupId)}/sessions/${encodeURIComponent(sessionId)}`);
  }
}
