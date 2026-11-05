/** GET /reservations/{reservationId}/guest-session-id */
export interface OwnerSessionResponse {
  guestSessionId: string;
}

/** Same Cognito-protected endpoint with view=state; strictly read-only. */
export interface OwnerGroupState {
  groupReservationId: string;
  status: 'Open' | 'Submitted';
  guestSessionId: string | null;
  startTime: string;
  endTime: string;
  maxGuestCount: number;
  locationAddress: string;
  submittedItems: { dishId: string; quantity: number }[] | null;
}
