using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Handlers.GuestSessions;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Orders;
using APIHandler.Repositories.Reservations;
using APIHandler.Services.GuestSessions;
using Moq;
using System.Text.Json;

namespace APIHandler.Tests.Services;

public class OwnerSubmittedReadTests
{
    private readonly Mock<IReservationRepository> reservations = new(MockBehavior.Strict);
    private readonly Mock<IGroupReservationRepository> groups = new(MockBehavior.Strict);
    private readonly Mock<IGuestSessionRepository> sessions = new(MockBehavior.Strict);
    private readonly Mock<IOrderRepository> orders = new(MockBehavior.Strict);
    private readonly Mock<IGroupPreOrderWriter> writer = new(MockBehavior.Strict);
    private GroupPreOrderService Service => new(reservations.Object, groups.Object, sessions.Object, orders.Object, writer.Object);
    private readonly Reservation reservation = new() { Id = "r", CustomerId = "owner", TableId = "t", WaiterId = "w",
        GuestCount = 4, StartTime = new DateTime(2026, 11, 5, 14, 15, 0, DateTimeKind.Utc) };
    private readonly GroupReservation group = new() { GroupReservationId = "g", ReservationId = "r",
        ReservationToken = "private-do-not-return", Status = GroupReservationStatus.Submitted };
    private readonly Order order = new() { OrderId = "o", ReservationId = "r", CustomerId = "owner",
        ReservationAddress = "Demo address", ReservationTime = "UTC display", Status = OrderStatus.SubmittedByCustomer,
        Dishes = [new() { DishId = "bowl", Quantity = 3 }, new() { DishId = "salad", Quantity = 3 }] };

    public OwnerSubmittedReadTests()
    {
        reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync(reservation);
        groups.Setup(x => x.GetByReservationIdAsync("r")).ReturnsAsync(group);
        orders.Setup(x => x.GetOrderByReservationIdAsync("r")).ReturnsAsync(order);
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([
            new GuestSession { Id = "owner-session", GuestName = "Owner", GroupReservationId = "g",
                OwnerUserId = "owner", IsOwnerSession = true, Dishes = [] }]);
    }

    [Fact]
    public async Task SubmittedRepeatedReadReturnsPersistedQuantitiesAndNeverWritesOrExposesInvite()
    {
        for (var i = 0; i < 2; i++)
        {
            var state = await Service.GetOwnerGroupStateAsync("owner", "r");
            Assert.Equal("Submitted", state.Status);
            Assert.Equal("g", state.GroupReservationId);
            Assert.Equal("owner-session", state.GuestSessionId);
            Assert.Equal(new[] { 3, 3 }, state.SubmittedItems!.Select(x => x.Quantity));
            Assert.Equal(reservation.StartTime, state.StartTime);
            Assert.DoesNotContain("private-do-not-return", JsonSerializer.Serialize(state));
        }
        writer.VerifyNoOtherCalls();
        sessions.Verify(x => x.GetAllByGroupReservationIdAsync("g"), Times.Exactly(2));
        sessions.VerifyNoOtherCalls();
        orders.Verify(x => x.GetOrderByReservationIdAsync("r"), Times.Exactly(2));
        orders.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task OpenReadDoesNotEnsureOrLoadOrderAndLeavesOriginalEnsureEndpointUnchanged()
    {
        group.Status = GroupReservationStatus.Open;
        var state = await Service.GetOwnerGroupStateAsync("owner", "r");
        Assert.Equal("Open", state.Status); Assert.Null(state.SubmittedItems);
        sessions.VerifyNoOtherCalls(); orders.VerifyNoOtherCalls(); writer.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task SubmittedMissingOwnerDoesNotCreateOne()
    {
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([]);
        Assert.Null((await Service.GetOwnerGroupStateAsync("owner", "r")).GuestSessionId);
        writer.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task NonOwnerCannotReadMetadataOrOrder()
    {
        await Assert.ThrowsAsync<ActionForbiddenException>(() => Service.GetOwnerGroupStateAsync("other", "r"));
        groups.VerifyNoOtherCalls(); orders.VerifyNoOtherCalls(); sessions.VerifyNoOtherCalls(); writer.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData("orderOwner")]
    [InlineData("orderReservation")]
    [InlineData("orderStatus")]
    [InlineData("groupReservation")]
    [InlineData("closed")]
    [InlineData("unknownStatus")]
    public async Task InconsistentStateFailsClosedWithoutWrites(string change)
    {
        if (change == "orderOwner") order.CustomerId = "other";
        if (change == "orderReservation") order.ReservationId = "other";
        if (change == "orderStatus") order.Status = OrderStatus.Created;
        if (change == "groupReservation") group.ReservationId = "other";
        if (change == "closed") group.Status = GroupReservationStatus.Closed;
        if (change == "unknownStatus") group.Status = (GroupReservationStatus)999;
        await Assert.ThrowsAsync<ValidationException>(() => Service.GetOwnerGroupStateAsync("owner", "r"));
        writer.VerifyNoOtherCalls();
    }

    private static APIGatewayProxyRequest Request(string? user = "owner") => new()
    {
        PathParameters = new Dictionary<string, string> { ["reservationId"] = "r" },
        QueryStringParameters = new Dictionary<string, string> { ["view"] = "state" },
        RequestContext = new() { Authorizer = new() { Claims = user == null ? new() : new() { ["sub"] = user } } }
    };
    private static ILambdaContext Context()
    {
        var context = new Mock<ILambdaContext>(); context.SetupGet(x => x.Logger).Returns(Mock.Of<ILambdaLogger>());
        return context.Object;
    }

    [Theory]
    [InlineData(null, 401)]
    [InlineData("other", 403)]
    [InlineData("owner", 200)]
    public async Task ExistingProtectedHandlerSupportsReadModeWithOwnerAuthorization(string? user, int status)
    {
        var response = await new GetOwnerSessionIdHandler(Service).HandleRequest(Request(user), Context());
        Assert.Equal(status, response.StatusCode);
        if (status == 200)
        {
            using var body = JsonDocument.Parse(response.Body);
            Assert.Equal("Submitted", body.RootElement.GetProperty("status").GetString());
            Assert.Equal(2, body.RootElement.GetProperty("submittedItems").GetArrayLength());
        }
        writer.VerifyNoOtherCalls();
        if (user == null) reservations.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task UnknownReadModeNeverFallsBackToOwnerCreation()
    {
        var request = Request(); request.QueryStringParameters["view"] = "typo";
        Assert.Equal(400, (await new GetOwnerSessionIdHandler(Service).HandleRequest(request, Context())).StatusCode);
        writer.VerifyNoOtherCalls(); reservations.VerifyNoOtherCalls();
    }
}
