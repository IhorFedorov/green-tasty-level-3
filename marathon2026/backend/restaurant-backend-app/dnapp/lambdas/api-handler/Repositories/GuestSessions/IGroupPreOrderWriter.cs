using APIHandler.Entities;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace APIHandler.Repositories.GuestSessions;

public interface IGroupPreOrderWriter
{
    Task<GuestSession> EnsureOwnerAsync(GuestSession candidate);
    Task SubmitAsync(GroupReservation group, Order order, List<OrderItem> items);
}
