using Amazon.CognitoIdentityProvider.Model;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Handlers.GuestSessions;
using APIHandler.Models.GuestSessions;
using APIHandler.Models.Orders;
using APIHandler.Repositories.Auth;
using APIHandler.Repositories.Dishes;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Reservations;
using APIHandler.Repositories.Tables;
using APIHandler.Services.GuestSessions;
using Moq;
using System.Text.Json;

namespace APIHandler.Tests.Services;

public class GroupSessionsLevel1Tests
{
    private readonly Mock<IGuestSessionRepository> sessions = new(MockBehavior.Strict);
    private readonly Mock<IGroupReservationRepository> groups = new(MockBehavior.Strict);
    private readonly Mock<IReservationRepository> reservations = new(MockBehavior.Strict);
    private readonly Mock<IDishRepository> dishes = new(MockBehavior.Strict);
    private readonly Mock<IUserRepository> users = new(MockBehavior.Strict);
    private GuestSessionService Service => new(groups.Object, sessions.Object, dishes.Object,
        reservations.Object, users.Object, Mock.Of<ITableRepository>());

    private void Owner(string owner = "owner")
    {
        groups.Setup(x => x.GetGroupReservationByIdAsync("g")).ReturnsAsync(new GroupReservation
        { GroupReservationId = "g", ReservationId = "r", ReservationToken = "unused" });
        reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync(new Reservation
        { Id = "r", CustomerId = owner, TableId = "t", WaiterId = "w" });
    }

    private static GuestSession Session(string id, bool submitted, string dishId, int quantity) => new()
    {
        Id = id, GroupReservationId = "g", GuestName = id, IsSubmitted = submitted,
        Dishes = [new OrderItem { DishId = dishId, Quantity = quantity }]
    };

    [Fact]
    public async Task Snapshot_IncludesDraftAndSubmitted_WithOriginalHomeworkTotals_AndNoWrites()
    {
        Owner();
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g"))
            .ReturnsAsync([Session("Andrii", true, "d1", 2), Session("Olena", false, "d2", 1)]);
        dishes.Setup(x => x.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([new Dish { Id = "d1", Name = "Caesar Salad", Price = 180 },
                          new Dish { Id = "d2", Name = "Tom Yum", Price = 220 }]);
        var result = await Service.GetGroupSessionsAsync("owner", "g");
        var people = result.Participants.ToArray();
        Assert.Equal(580m, result.Total);
        Assert.Equal(new[] { 360m, 220m }, people.Select(x => x.Total));
        Assert.True(people[0].IsSubmitted);
        Assert.False(people[1].IsSubmitted);
        Assert.All(people, p => Assert.Equal(ParticipantType.Guest, p.Type));
        Assert.Equal(2, people[0].Items.Single().Quantity);
        Assert.Equal("d1", people[0].Items.Single().Dish.Id);
        sessions.Verify(x => x.GetAllByGroupReservationIdAsync("g"), Times.Once);
        sessions.VerifyNoOtherCalls(); // strict repositories also reject any unexpected write
    }

    [Fact]
    public async Task EmptyGroup_ReturnsZero_WithoutCreatingOwnerOrLoadingDishes()
    {
        Owner();
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([]);
        var result = await Service.GetGroupSessionsAsync("owner", "g");
        Assert.Empty(result.Participants);
        Assert.Equal(0m, result.Total);
        dishes.VerifyNoOtherCalls();
        users.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task ExistingOwner_UsesProfile_AndDecimalTotals()
    {
        Owner();
        var session = Session("s", true, "d", 3);
        session.IsOwnerSession = true;
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([session]);
        dishes.Setup(x => x.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([new Dish { Id = "d", Name = "Dish", Price = 0.15m }]);
        users.Setup(x => x.GetUserByIdAsync("owner")).ReturnsAsync(new UserType
        { Attributes = [new AttributeType { Name = "given_name", Value = "Owner Name" }] });
        var result = await Service.GetGroupSessionsAsync("owner", "g");
        Assert.Equal(ParticipantType.Owner, result.Participants.Single().Type);
        Assert.Equal("Owner Name", result.Participants.Single().Name);
        Assert.Equal(0.45m, result.Total);
    }

    [Fact]
    public async Task NonOwner_IsRejectedBeforeReadingSessions()
    {
        Owner();
        await Assert.ThrowsAsync<ActionForbiddenException>(() => Service.GetGroupSessionsAsync("other", "g"));
        sessions.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task MissingGroup_Is404DomainException()
    {
        groups.Setup(x => x.GetGroupReservationByIdAsync("g")).ReturnsAsync((GroupReservation?)null);
        await Assert.ThrowsAsync<GroupReservationNotFoundException>(() => Service.GetGroupSessionsAsync("owner", "g"));
        sessions.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task MissingReservation_Is404DomainException()
    {
        groups.Setup(x => x.GetGroupReservationByIdAsync("g")).ReturnsAsync(new GroupReservation
        { GroupReservationId = "g", ReservationId = "r", ReservationToken = "unused" });
        reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync((Reservation?)null);
        await Assert.ThrowsAsync<ReservationNotFoundException>(() => Service.GetGroupSessionsAsync("owner", "g"));
        sessions.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task MissingCatalogDish_IsValidationInsteadOfWrongTotal()
    {
        Owner();
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([Session("s", false, "missing", 1)]);
        dishes.Setup(x => x.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>())).ReturnsAsync(Array.Empty<Dish>());
        await Assert.ThrowsAsync<ValidationException>(() => Service.GetGroupSessionsAsync("owner", "g"));
    }

    private static APIGatewayProxyRequest Request(string? path = "g", string? sub = "owner")
    {
        var request = new APIGatewayProxyRequest { PathParameters = new Dictionary<string, string>() };
        if (path != null) request.PathParameters["groupReservationId"] = path;
        if (sub != null) request.RequestContext = new APIGatewayProxyRequest.ProxyRequestContext
        { Authorizer = new APIGatewayCustomAuthorizerContext
          { Claims = new Dictionary<string, string> { ["sub"] = sub } } };
        return request;
    }
    private static ILambdaContext Context()
    {
        var context = new Mock<ILambdaContext>();
        context.SetupGet(x => x.Logger).Returns(Mock.Of<ILambdaLogger>());
        return context.Object;
    }

    [Theory]
    [InlineData(null, "owner", 400)]
    [InlineData(" ", "owner", 400)]
    [InlineData("g", null, 401)]
    [InlineData("g", "", 401)]
    [InlineData("g", " ", 401)]
    public async Task Handler_InvalidRequest_DoesNotCallService(string? path, string? sub, int status)
    {
        var service = new Mock<IGuestSessionService>(MockBehavior.Strict);
        var response = await new GetGroupSessionsHandler(service.Object).HandleRequest(Request(path, sub), Context());
        Assert.Equal(status, response.StatusCode);
        Assert.True(JsonDocument.Parse(response.Body).RootElement.TryGetProperty("error", out _));
        service.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(404, "group")]
    [InlineData(404, "reservation")]
    [InlineData(403, "owner")]
    [InlineData(400, "validation")]
    public async Task Handler_MapsDomainErrors(int expected, string kind)
    {
        Exception error = kind switch
        {
            "group" => new GroupReservationNotFoundException(),
            "reservation" => new ReservationNotFoundException("missing"),
            "owner" => new ActionForbiddenException("forbidden"),
            _ => new ValidationException("invalid")
        };
        var service = new Mock<IGuestSessionService>();
        service.Setup(x => x.GetGroupSessionsAsync("owner", "g")).ThrowsAsync(error);
        var response = await new GetGroupSessionsHandler(service.Object).HandleRequest(Request(), Context());
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task Handler_SerializesActualNestedResponseAsCamelCase()
    {
        var service = new Mock<IGuestSessionService>();
        service.Setup(x => x.GetGroupSessionsAsync("owner", "g")).ReturnsAsync(new GetAllSessionsResponse(
            [new Participant("s", ParticipantType.Guest, "Andrii",
                [new OrderItemResponse { Dish = APIHandler.Mappers.DishMapper.ToDishResponse(new Dish
                    { Id = "d", Name = "Salad", Price = 180 }), Quantity = 2 }], 360, true)], 360));
        var response = await new GetGroupSessionsHandler(service.Object).HandleRequest(Request(), Context());
        Assert.Equal(200, response.StatusCode);
        using var json = JsonDocument.Parse(response.Body);
        var root = json.RootElement;
        Assert.False(root.TryGetProperty("Participants", out _));
        var p = root.GetProperty("participants")[0];
        Assert.Equal("Guest", p.GetProperty("type").GetString());
        Assert.True(p.GetProperty("isSubmitted").GetBoolean());
        Assert.Equal("Andrii", p.GetProperty("name").GetString());
        Assert.Equal("s", p.GetProperty("id").GetString());
        Assert.Equal(360, p.GetProperty("total").GetDecimal());
        Assert.Equal(180, p.GetProperty("items")[0].GetProperty("dish").GetProperty("price").GetDecimal());
        Assert.Equal(2, p.GetProperty("items")[0].GetProperty("quantity").GetInt32());
        Assert.Equal(360, root.GetProperty("total").GetDecimal());
    }
}
