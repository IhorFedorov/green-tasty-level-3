export interface GuestInvite {
  /** Client-only path derived from the authenticated invitation response. */
  invitationPath?: string;
  GroupReservationId: string;
  LocationId: string;
  RestaurantName: string;
  LocationAddress: string;
  StartTime: string;
  EndTime: string;
  MaxGuestCount: number;
  TableNumber: number;
  InviterName: string;
}

export interface GroupInviteToken {
  token: string;
}
