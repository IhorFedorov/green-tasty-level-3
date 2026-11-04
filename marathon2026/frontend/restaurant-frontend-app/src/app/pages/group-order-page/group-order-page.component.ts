import { CurrencyPipe, DatePipe } from '@angular/common';
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
import { consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';

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
  readonly refreshing = signal(false);
  readonly updatedAt = signal<Date | null>(null);
  readonly refreshFailed = signal(false);
  readonly consolidated = computed(() => consolidatePreOrder(this.participants()));
  readonly pendingCount = computed(() => this.participants().filter(person => !person.isSubmitted).length);
  readonly open = computed(() => this.groupStatus()?.status === 'Open');
  readonly empty = computed(() => !this.participants().some(person => person.items.length));
  readonly canSubmit = computed(() => this.open() && !!this.consolidated().items.length && !this.submitting() && !this.refreshing());

  constructor() { this.load(); }
  load(): void {
    if (this.submitting()) return;
    this.stopSync();
    this.loadRequest?.unsubscribe();
    this.loading.set(true);
    this.error.set('');
    this.loadRequest = this.service.getGroupInvite$(this.reservationId).pipe(
      // Ensure Owner before enumerating sessions; no deliberate create/read race.
      switchMap(invite => this.service.getOwnerSessionId$(this.reservationId).pipe(map(owner => ({ invite, owner })))),
      switchMap(({ invite, owner }) => forkJoin({
        sessions: this.service.getSessions$(invite.GroupReservationId),
        status: this.service.getStatus$(invite.GroupReservationId),
      }).pipe(map(data => ({ ...data, invite, owner })))),
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
