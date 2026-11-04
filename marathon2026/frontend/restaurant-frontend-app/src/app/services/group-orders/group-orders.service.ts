import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, switchMap } from 'rxjs';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { SKIP_ERROR_TOAST } from '@app/auth/skip-error-toast.context';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';
import { OwnerSessionResponse } from '@app/models/group-orders/owner-session.model';
import { SubmittedDish } from '@app/models/group-orders/submit-group-pre-order.model';

@Injectable({ providedIn: 'root' })
export class GroupOrdersService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);
  private readonly invites = inject(GuestInviteService);
  getGroupInvite$(reservationId: string) {
    return this.invites.getInviteToken$(reservationId).pipe(switchMap(({ token }) => this.invites.getInvite$(token)));
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
    return this.http.post<SubmittedDish[]>(`${this.base}/group-reservations/${encodeURIComponent(groupId)}/submit`, { reservationId });
  }
  removeSession$(groupId: string, sessionId: string) {
    return this.http.delete<GroupSessionsResponse>(`${this.base}/guest/groups/${encodeURIComponent(groupId)}/sessions/${encodeURIComponent(sessionId)}`);
  }
}
