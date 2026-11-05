import { CurrencyPipe, DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Subscription, catchError, exhaustMap, finalize, forkJoin, map, switchMap, tap, timer } from 'rxjs';
import { ParticipantCardComponent } from '@app/components/group-orders/participant-card/participant-card.component';
import { ModalComponent } from '@app/shared/custom-components/modal/modal.component';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { Participant } from '@app/models/group-orders/participant.model';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';
import { ConsolidatedOrder, consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';

@Component({
  selector: 'app-group-order-page',
  imports: [CurrencyPipe, DatePipe, ParticipantCardComponent, ModalComponent],
  templateUrl: './group-order-page.component.html',
  styleUrl: './group-order-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupOrderPageComponent {
  private readonly service = inject(GroupOrdersService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private poll?: Subscription;
  private refreshRequest?: Subscription;
  private loadRequest?: Subscription;
  private readonly reservationId = this.route.snapshot.paramMap.get('reservationId') ?? '';
  readonly invite = signal<GuestInvite | null>(null);
  readonly participants = signal<Participant[]>([]);
  readonly ownerSessionId = signal('');
  readonly groupStatus = signal<GroupStatusResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly submitting = signal(false);
  readonly confirmSubmit = signal(false);
  readonly inviteDialog = signal(false);
  readonly copyingInvite = signal(false);
  readonly inviteLink = computed(() => {
    const path = this.invite()?.invitationPath;
    return this.open() && path?.startsWith('/join/') ? new URL(path, this.document.location.origin).href : '';
  });
  readonly refreshing = signal(false);
  readonly updatedAt = signal<Date | null>(null);
  readonly refreshFailed = signal(false);
  private readonly submittedOrder = signal<ConsolidatedOrder | null>(null);
  readonly consolidated = computed(() => this.submittedOrder() ?? consolidatePreOrder(this.participants()));
  readonly pendingCount = computed(() => this.participants().filter(person => !person.isSubmitted).length);
  readonly open = computed(() => this.groupStatus()?.status === 'Open');
  readonly empty = computed(() => !this.participants().some(person => person.items.length));
  readonly canSubmit = computed(() => this.open() && !!this.consolidated().items.length && !this.submitting() && !this.refreshing());

  constructor() { this.load(); }
  showInvite(): void {
    if (!this.loading() && !this.error() && this.inviteLink() && !this.submitting()) this.inviteDialog.set(true);
  }
  async copyInviteLink(): Promise<void> {
    const link = this.inviteLink();
    if (!this.inviteDialog() || !link || this.copyingInvite() || this.submitting()) return;
    this.copyingInvite.set(true);
    try {
      const clipboard = this.document.defaultView?.navigator.clipboard;
      if (!clipboard) throw new Error('Clipboard unavailable');
      await clipboard.writeText(link);
      this.toast.success('Share it with your friends.', 'Link copied!');
    } catch {
      this.toast.error('Could not copy the link. Select the link and copy it manually.');
    } finally { this.copyingInvite.set(false); }
  }
  load(): void {
    if (this.submitting()) return;
    this.stopSync();
    this.loadRequest?.unsubscribe();
    this.loading.set(true);
    this.error.set('');
    this.inviteDialog.set(false);
    this.loadRequest = this.service.getOwnerState$(this.reservationId).pipe(
      switchMap(state => {
        this.submittedOrder.set(null);
        if (state.status === 'Submitted') {
          return forkJoin({ sessions: this.service.getSessions$(state.groupReservationId), status: this.service.getStatus$(state.groupReservationId) }).pipe(
            map(({ sessions, status }) => {
              if (status.status !== 'Submitted' || !state.submittedItems?.length)
                throw new Error('Submitted order is unavailable');
              const catalog = new Map(sessions.participants.flatMap(person => person.items).map(item => [item.dish.id, item.dish]));
              const items = state.submittedItems.map(item => {
                const dish = catalog.get(item.dishId);
                if (!dish || item.quantity <= 0) throw new Error('Submitted dish is unavailable');
                return { dish, quantity: item.quantity };
              });
              this.submittedOrder.set({ items, total: items.reduce((total, item) => total + item.dish.price * item.quantity, 0) });
              const invite = { GroupReservationId: state.groupReservationId, LocationAddress: state.locationAddress,
                StartTime: state.startTime, EndTime: state.endTime, MaxGuestCount: state.maxGuestCount } as GuestInvite;
              return { sessions, status, owner: state.guestSessionId ?? '', invite };
            }),
          );
        }
        if (state.status !== 'Open') throw new Error('Unsupported group status');
        // Keep the existing invitation + Owner ensure sequence for Open groups only.
        return this.service.getGroupInvite$(this.reservationId).pipe(
          // Ensure Owner before enumerating sessions; no deliberate create/read race.
          switchMap(invite => {
            if (invite.GroupReservationId !== state.groupReservationId) throw new Error('Invitation belongs to another group');
            return this.service.getOwnerSessionId$(this.reservationId).pipe(map(owner => ({ invite, owner })));
          }),
          switchMap(({ invite, owner }) => forkJoin({
            sessions: this.service.getSessions$(invite.GroupReservationId),
            status: this.service.getStatus$(invite.GroupReservationId),
          }).pipe(map(data => ({ ...data, invite, owner })))),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: ({ sessions, status, owner, invite }) => {
        this.invite.set(invite); this.ownerSessionId.set(owner);
        this.participants.set(sessions.participants); this.groupStatus.set(status);
        this.updatedAt.set(new Date()); this.refreshFailed.set(false); this.startSync();
      },
      error: (err: HttpErrorResponse) => this.error.set(err.status === 404 ? 'Group reservation not found' : 'Could not load the group reservation'),
    });
  }
  private startSync(): void {
    this.poll?.unsubscribe();
    if (!this.open()) return;
    this.poll = timer(15_000, 15_000).pipe(exhaustMap(() => this.refresh$()), takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  refresh(): void {
    if (!this.open() || this.submitting() || this.refreshing()) return;
    this.refreshRequest = this.refresh$().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  private refresh$() {
    const groupId = this.invite()?.GroupReservationId;
    if (!groupId || !this.open() || this.submitting() || this.refreshing()) return EMPTY;
    this.refreshing.set(true);
    return forkJoin({ sessions: this.service.getSessions$(groupId, { silent: true }), status: this.service.getStatus$(groupId, { silent: true }) }).pipe(
      tap(({ sessions, status }) => {
        if (!this.submitting() && this.open()) {
          this.participants.set(sessions.participants); this.groupStatus.set(status);
          this.updatedAt.set(new Date()); this.refreshFailed.set(false);
          if (status.status !== 'Open') this.poll?.unsubscribe();
        }
      }),
      catchError(() => { this.refreshFailed.set(true); return EMPTY; }),
      finalize(() => this.refreshing.set(false)),
    );
  }
  private stopSync(): void { this.poll?.unsubscribe(); this.refreshRequest?.unsubscribe(); }
  submit(): void {
    const groupId = this.invite()?.GroupReservationId;
    if (!groupId || !this.confirmSubmit() || !this.canSubmit()) return;
    this.submitting.set(true); this.stopSync();
    this.service.submit$(groupId, this.reservationId).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.submitting.set(false))).subscribe({
      next: () => {
        this.groupStatus.update(status => status ? { ...status, status: 'Submitted' } : status);
        this.confirmSubmit.set(false); this.toast.success('Pre-order sent to the restaurant');
      },
      error: () => { this.confirmSubmit.set(false); this.startSync(); },
    });
  }
}
