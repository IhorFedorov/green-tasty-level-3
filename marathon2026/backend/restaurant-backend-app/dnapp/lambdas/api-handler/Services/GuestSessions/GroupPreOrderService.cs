using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Orders;
using APIHandler.Repositories.Reservations;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace APIHandler.Services.GuestSessions;

public record ConsolidatedDish(string DishId, int Quantity);

public class GroupPreOrderService(IReservationRepository reservations, IGroupReservationRepository groups,
    IGuestSessionRepository sessions, IOrderRepository orders, IGroupPreOrderWriter writer)
{
    private async Task<Reservation> OwnerAsync(string userId, string reservationId)
    {
        if (string.IsNullOrWhiteSpace(reservationId)) throw new ValidationException("Missing reservationId.");
        var reservation = await reservations.GetReservationByIdAsync(reservationId)
            ?? throw new ReservationNotFoundException("Reservation not found.");
        if (string.IsNullOrWhiteSpace(userId) || reservation.CustomerId != userId)
            throw new ActionForbiddenException("Only the reservation owner can perform this action.");
        return reservation;
    }

    public async Task<string> GetOwnerSessionIdAsync(string userId, string reservationId)
    {
        await OwnerAsync(userId, reservationId);
        var group = await groups.GetByReservationIdAsync(reservationId)
            ?? throw new GroupReservationNotFoundException();
        var owners = (await sessions.GetAllByGroupReservationIdAsync(group.GroupReservationId))
            .Where(s => s.IsOwnerSession).ToArray();
        if (owners.Length > 1 || owners.Any(s => s.OwnerUserId != userId))
            throw new ValidationException("Conflicting owner sessions; manual review required.");
        if (owners.Length == 1) return owners[0].Id;
        if (group.Status != GroupReservationStatus.Open)
            throw new ValidationException("Cannot create owner session for a closed or submitted group.");
        // Stable per reservation/owner, including concurrent calls with stale GSI results.
        var id = "owner-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(reservationId + "\n" + userId)));
        var owner = await writer.EnsureOwnerAsync(new GuestSession
        {
            Id = id, GroupReservationId = group.GroupReservationId, GuestName = "Owner", Dishes = [],
            IsOwnerSession = true, OwnerUserId = userId
        });
        return owner.Id;
    }

    public async Task<IReadOnlyList<ConsolidatedDish>> SubmitAsync(string userId, string groupId, string reservationId)
    {
        if (string.IsNullOrWhiteSpace(groupId)) throw new ValidationException("Missing groupReservationId.");
        await OwnerAsync(userId, reservationId);
        var group = await groups.GetGroupReservationByIdAsync(groupId) ?? throw new GroupReservationNotFoundException();
        if (group.ReservationId != reservationId) throw new ValidationException("Reservation does not belong to this group.");
        if (group.Status != GroupReservationStatus.Open) throw new ValidationException("Group is closed or already submitted.");
        var submitted = (await sessions.GetAllByGroupReservationIdAsync(groupId)).Where(s => s.IsSubmitted).ToArray();
        if (submitted.Length == 0) throw new ValidationException("No submitted sessions.");
        var items = submitted.SelectMany(s => s.Dishes).ToArray();
        if (items.Length == 0) throw new ValidationException("Submitted sessions contain no dishes.");
        if (items.Any(i => string.IsNullOrWhiteSpace(i.DishId) || i.Quantity <= 0))
            throw new ValidationException("Invalid dish or quantity in submitted sessions.");
        List<OrderItem> consolidated;
        try
        {
            consolidated = items.GroupBy(i => i.DishId).OrderBy(g => g.Key, StringComparer.Ordinal)
                .Select(g => new OrderItem { DishId = g.Key, Quantity = g.Sum(i => i.Quantity) }).ToList();
        }
        catch (OverflowException) { throw new ValidationException("Consolidated quantity exceeds supported range."); }
        var order = await orders.GetOrderByReservationIdAsync(reservationId)
            ?? throw new ValidationException("Order not found.");
        if (order.CustomerId != userId || order.ReservationId != reservationId || order.Status != OrderStatus.Created)
            throw new ValidationException("Order is not an editable order for this reservation owner.");
        await writer.SubmitAsync(group, order, consolidated);
        return consolidated.Select(i => new ConsolidatedDish(i.DishId, i.Quantity)).ToArray();
    }
}
