import { Injectable, computed, effect, signal, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GuestMenuDish } from '@app/services/guest-sessions/guest-sessions.service';
import { GuestSessionsService } from '@app/services/guest-sessions/guest-sessions.service';

export type GuestPreorderStatus = 'active' | 'submitted';

export interface GuestInviteVm {
    inviterName: string;
    restaurantName: string;
    locationAddress: string;
    tableNumberText: string;
    dateText: string;
    timeText: string;
    guestsText: string;
}

export interface GuestCartItem {
    dishId: string;
    title: string;
    price: number;
    imageUrl?: string;
    qty: number;
}

@Injectable({ providedIn: 'root' })
export class GuestPreorderStore {
    private readonly contextId = signal<string | null>(null);
    private readonly pendingCartSessions = new Set<string>();
    private readonly pendingSubmits = new Set<string>();
    private readonly completedCarts = new Map<string, { items: GuestCartItem[]; name: string }>();
    private readonly guestInviteService = inject(GuestInviteService);

    readonly invite = signal<GuestInvite | null>(null);
    readonly inviteLoading = signal(false);
    readonly inviteError = signal<'expired' | 'retryable' | null>(null);

    readonly guestName = signal<string>('');
    readonly status = signal<GuestPreorderStatus>('active');
    readonly cartItems = signal<GuestCartItem[]>([]);

    private readonly guestSessionsService = inject(GuestSessionsService);

    readonly joinLoading = signal(false);
    readonly joinError = signal<string | null>(null);

    readonly guestSessionId = signal<string | null>(null);
    readonly guestSessionToken = signal<string | null>(null);
    readonly menuLoading = signal(false);
    readonly menuError = signal<string | null>(null);
    readonly cartBusy = signal(false);
    readonly cartError = signal<string | null>(null);

    readonly menuByCategory = signal<Record<string, GuestMenuDish[]>>({});
    readonly menuCategories = computed(() => Object.keys(this.menuByCategory()));
    readonly hasMenu = computed(() =>
        Object.values(this.menuByCategory()).some(dishes => dishes.length > 0)
    );

    readonly total = computed(() =>
        this.cartItems().reduce((sum, i) => sum + i.price * i.qty, 0)
    );
    readonly itemCount = computed(() => this.cartItems().reduce((sum, item) => sum + item.qty, 0));

    constructor() {
        effect(() => {
            const ctx = this.contextId();
            if (!ctx) return;

            // IMPORTANT: after submit do not persist anything
            if (this.status() !== 'active') return;

            localStorage.setItem(this.key(ctx, 'guestName'), this.guestName());
            localStorage.setItem(this.key(ctx, 'cart'), JSON.stringify(this.cartItems()));
            localStorage.setItem(this.key(ctx, 'guestSessionId'), this.guestSessionId() ?? '');
            localStorage.setItem(this.key(ctx, 'guestSessionToken'), this.guestSessionToken() ?? '');
        });
    }

    initContext(id: string) {
        if (!id) return;
        if (this.contextId() === id) return;

        // A new invitation is a separate guest cart, never the previous session's state.
        this.guestSessionId.set(null); this.guestSessionToken.set(null);
        this.guestName.set(''); this.cartItems.set([]); this.invite.set(null);
        this.status.set('active'); this.menuByCategory.set({});
        this.cartBusy.set(false); this.cartError.set(null); this.joinError.set(null);
        this.joinLoading.set(false); this.menuLoading.set(false); this.menuError.set(null);
        this.contextId.set(id);
        void this.loadInviteByToken(id);

        const name = localStorage.getItem(this.key(id, 'guestName'));
        const cartRaw = localStorage.getItem(this.key(id, 'cart'));

        const sessionId = localStorage.getItem(this.key(id, 'guestSessionId'));
        const sessionToken = localStorage.getItem(this.key(id, 'guestSessionToken'));

        if (sessionId) this.guestSessionId.set(sessionId);
        if (sessionToken) this.guestSessionToken.set(sessionToken);
        if (sessionId && (this.pendingCartSessions.has(sessionId) || this.pendingSubmits.has(sessionId))) this.cartBusy.set(true);
        const completed = sessionId ? this.completedCarts.get(sessionId) : undefined;

        // If guest was already joined on this device/browser, load menu automatically
        if (!completed && this.guestSessionId() && this.guestSessionToken()) {
            void this.loadMenu();
        }

        if (name) this.guestName.set(name);

        if (cartRaw) {
            try {
                const parsed = JSON.parse(cartRaw);
                if (Array.isArray(parsed)) this.cartItems.set(parsed);
            } catch {
                // ignore parse errors
            }
        }
        if (completed) {
            this.cartItems.set(completed.items); this.guestName.set(completed.name); this.status.set('submitted');
        }
    }

    async loadInviteByToken(token: string) {
        this.inviteLoading.set(true);
        this.inviteError.set(null);

        try {
            const inv = await firstValueFrom(this.guestInviteService.getInvite$(token));
            if (this.contextId() !== token) return;
            this.invite.set(inv);
        } catch (error) {
            if (this.contextId() !== token) return;
            this.invite.set(null);
            const status = error instanceof HttpErrorResponse ? error.status : null;
            this.inviteError.set(status === 404 || status === 410 ? 'expired' : 'retryable');
        } finally {
            if (this.contextId() === token) this.inviteLoading.set(false);
        }
    }

    async join(name: string) {
        const context = this.contextId();
        const inv = this.invite();
        if (!inv) {
            this.joinError.set('Invite is not loaded yet');
            return;
        }

        this.setGuestName(name);

        const groupReservationId = inv.GroupReservationId;
        if (!groupReservationId) {
            this.joinError.set('Invite is missing GroupReservationId');
            return;
        }

        const payload = {
            groupReservationId,
            guestName: this.guestName(),
        };

        console.log('[join payload]', payload);

        this.joinLoading.set(true);
        this.joinError.set(null);

        try {
            const res = await firstValueFrom(this.guestSessionsService.createSession(payload));
            if (this.contextId() !== context) return;
            this.guestSessionId.set(res.SessionId);
            this.guestSessionToken.set(res.SessionToken);
            await this.loadMenu();
        } catch (e) {
            if (this.contextId() !== context) return;
            console.log('[join error]', e);
            this.joinError.set('Failed to join session');
        } finally {
            if (this.contextId() === context) this.joinLoading.set(false);
        }
    }

    readonly inviteVm = computed<GuestInviteVm | null>(() => {
        const inv = this.invite();
        if (!inv) return null;

        const inviterName = inv.InviterName ?? 'Someone';
        const restaurantName = inv.RestaurantName ?? '—';
        const locationAddress = inv.LocationAddress ?? '—';

        const tableNumberText =
            inv.TableNumber != null && String(inv.TableNumber).trim() !== ''
                ? `Table ${inv.TableNumber}`
                : '—';

        const startText = inv.StartTime ? String(inv.StartTime) : '';
        const endText = inv.EndTime ? String(inv.EndTime) : '';

        const dateText = startText
            ? new Date(startText).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
            : '—';

        const timeText = (startText && endText)
            ? `${new Date(startText).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${new Date(endText).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
            : '—';

        const guestsText = inv.MaxGuestCount != null ? `${inv.MaxGuestCount} people` : '—';

        return { inviterName, restaurantName, locationAddress, tableNumberText, dateText, timeText, guestsText };
    });

    readonly inviteText = computed(() => {
        const vm = this.inviteVm();
        if (!vm) return null;

        const parts = [vm.locationAddress, vm.tableNumberText, vm.timeText].filter(Boolean);
        return `You are making a pre-order for the reservation ${parts.join(', ')}`;
    });

    async loadMenu() {
        const context = this.contextId();
        const id = this.guestSessionId();
        const token = this.guestSessionToken();
        if (!id || !token) return;

        this.menuLoading.set(true);
        this.menuError.set(null);

        try {
            const res = await firstValueFrom(this.guestSessionsService.getMenu(id, token));
            if (this.contextId() !== context || this.guestSessionId() !== id) return;
            console.log('[menu response]', res);
            console.log('[menu dishes keys]', Object.keys(res.dishes ?? {}));

            this.menuByCategory.set(res.dishes ?? {});
        } catch (e) {
            if (this.contextId() !== context || this.guestSessionId() !== id) return;
            console.log('[menu error]', e);
            this.menuError.set('Failed to load menu');
            this.menuByCategory.set({});
        } finally {
            if (this.contextId() === context && this.guestSessionId() === id) this.menuLoading.set(false);
        }
    }

    setGuestName(name: string) {
        this.guestName.set(name.trim());
    }

    async addDish(item: Omit<GuestCartItem, 'qty'>): Promise<boolean> {
        return this.changeRemoteQuantity(item.dishId, 1, 'add', items => {
            const existing = items.find(cartItem => cartItem.dishId === item.dishId);
            return existing
                ? items.map(cartItem => cartItem.dishId === item.dishId
                    ? { ...cartItem, qty: cartItem.qty + 1 }
                    : cartItem)
                : [...items, { ...item, qty: 1 }];
        });
    }

    async inc(dishId: string): Promise<boolean> {
        return this.changeRemoteQuantity(dishId, 1, 'add', items => {
            return items.map(item =>
                item.dishId === dishId ? { ...item, qty: item.qty + 1 } : item
            );
        });
    }

    async dec(dishId: string): Promise<boolean> {
        return this.changeRemoteQuantity(dishId, 1, 'remove', items => {
            return items
                .map(item => item.dishId === dishId ? { ...item, qty: item.qty - 1 } : item)
                .filter(item => item.qty > 0);
        });
    }

    async remove(dishId: string): Promise<boolean> {
        const item = this.cartItems().find(cartItem => cartItem.dishId === dishId);
        if (!item) return false;

        return this.changeRemoteQuantity(dishId, item.qty, 'remove', items => {
            return items.filter(cartItem => cartItem.dishId !== dishId);
        });
    }

    async submitPreorder() {
        const context = this.contextId();
        const sessionId = this.guestSessionId();
        const token = this.guestSessionToken();
        if (!sessionId || !token) {
            this.cartError.set('Your guest session has expired. Please rejoin the reservation.');
            return;
        }
        if (this.cartItems().length === 0 || this.cartBusy() || this.pendingSubmits.has(sessionId) || this.status() !== 'active') return;

        const submittedCart = { items: this.cartItems(), name: this.guestName() };
        this.pendingSubmits.add(sessionId);
        this.cartBusy.set(true);
        this.cartError.set(null);
        try {
            await firstValueFrom(this.guestSessionsService.submit(sessionId, token));
            this.completedCarts.set(sessionId, submittedCart);
            if (this.contextId() === context && this.guestSessionId() === sessionId) this.submitSuccess();
            else if (context && localStorage.getItem(this.key(context, 'guestSessionId')) === sessionId) this.clearStorage(context);
        } catch {
            if (this.contextId() !== context || this.guestSessionId() !== sessionId) return;
            this.cartError.set('Could not submit your pre-order. Please try again.');
        } finally {
            this.pendingSubmits.delete(sessionId);
            if (this.contextId() === context && this.guestSessionId() === sessionId) this.cartBusy.set(false);
        }
    }

    // call this only after API submit success
    submitSuccess() {
        this.status.set('submitted');

        const ctx = this.contextId();
        if (ctx) this.clearStorage(ctx);
    }

    async createNewPreorder() {
        const ctx = this.contextId();
        const invite = this.invite();
        const guestName = this.guestName().trim();
        if (!ctx || !invite?.GroupReservationId || !guestName || this.joinLoading()) return;

        localStorage.removeItem(this.key(ctx, 'cart'));
        localStorage.removeItem(this.key(ctx, 'guestSessionId'));
        localStorage.removeItem(this.key(ctx, 'guestSessionToken'));

        this.guestSessionId.set(null);
        this.guestSessionToken.set(null);
        this.menuByCategory.set({});
        this.menuError.set(null);
        this.menuLoading.set(true);
        this.cartItems.set([]);
        this.status.set('active');
        this.joinLoading.set(true);

        try {
            const session = await firstValueFrom(this.guestSessionsService.createSession({
                groupReservationId: invite.GroupReservationId,
                guestName,
            }));
            if (this.contextId() !== ctx) return;
            this.guestSessionId.set(session.SessionId);
            this.guestSessionToken.set(session.SessionToken);
            await this.loadMenu();
        } catch {
            if (this.contextId() !== ctx) return;
            this.menuError.set('Could not start a new pre-order. Please try again.');
        } finally {
            if (this.contextId() === ctx) { this.menuLoading.set(false); this.joinLoading.set(false); }
        }
    }

    private async changeRemoteQuantity(
        dishId: string,
        quantity: number,
        operation: 'add' | 'remove',
        updateLocalCart: (items: GuestCartItem[]) => GuestCartItem[],
    ): Promise<boolean> {
        const context = this.contextId();
        const sessionId = this.guestSessionId();
        const token = this.guestSessionToken();
        if (!sessionId || !token) {
            this.cartError.set('Your guest session has expired. Please rejoin the reservation.');
            return false;
        }
        if (this.cartBusy() || this.pendingCartSessions.has(sessionId) || this.pendingSubmits.has(sessionId) || this.status() !== 'active') return false;

        const previousCart = this.cartItems();
        this.pendingCartSessions.add(sessionId);

        this.cartBusy.set(true);
        this.cartError.set(null);
        try {
            const request = operation === 'add'
                ? this.guestSessionsService.addDish(sessionId, token, dishId, quantity)
                : this.guestSessionsService.removeDish(sessionId, token, dishId, quantity);
            await firstValueFrom(request);
            const updated = updateLocalCart(previousCart);
            if (this.contextId() === context && this.guestSessionId() === sessionId) this.cartItems.set(updated);
            else if (context && localStorage.getItem(this.key(context, 'guestSessionId')) === sessionId)
                localStorage.setItem(this.key(context, 'cart'), JSON.stringify(updated));
            return true;
        } catch {
            if (this.contextId() !== context || this.guestSessionId() !== sessionId) return false;
            this.cartError.set('Could not update your cart. Please try again.');
            return false;
        } finally {
            this.pendingCartSessions.delete(sessionId);
            if (this.contextId() === context && this.guestSessionId() === sessionId) this.cartBusy.set(false);
        }
    }

    private clearStorage(ctx: string) {
        localStorage.removeItem(this.key(ctx, 'guestName'));
        localStorage.removeItem(this.key(ctx, 'cart'));
        localStorage.removeItem(this.key(ctx, 'status'));
        // cleanup legacy
    }

    private key(
        ctx: string,
        part: 'guestName' | 'cart' | 'status' | 'guestSessionId' | 'guestSessionToken'
    ) {
        return `guestPreorder:${ctx}:${part}`;
    }

}
