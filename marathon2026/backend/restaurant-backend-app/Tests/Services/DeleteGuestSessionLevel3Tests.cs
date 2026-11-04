using Amazon.CognitoIdentityProvider.Model;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Models.GuestSessions;
using APIHandler.Handlers.GuestSessions;
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

public class DeleteGuestSessionLevel3Tests
{
    private readonly Mock<IGuestSessionRepository> sessions = new(MockBehavior.Strict);
    private readonly Mock<IGroupReservationRepository> groups = new(MockBehavior.Strict);
    private readonly Mock<IReservationRepository> reservations = new(MockBehavior.Strict);
    private readonly Mock<IDishRepository> dishes = new(MockBehavior.Strict);
    private readonly Mock<IUserRepository> users = new(MockBehavior.Strict);
    private GuestSessionService Service => new(groups.Object, sessions.Object, dishes.Object,
        reservations.Object, users.Object, Mock.Of<ITableRepository>());
    private readonly GuestSession deleted = Guest("removed", true, "deleted-dish", 2);
    private static GuestSession Guest(string id, bool submitted, string dish, int qty) => new()
    { Id = id, GuestName = id, GroupReservationId = "g", IsSubmitted = submitted,
      Dishes = [new OrderItem { DishId = dish, Quantity = qty }] };
    private void Owner()
    {
        groups.Setup(x => x.GetGroupReservationByIdAsync("g")).ReturnsAsync(new GroupReservation
        { GroupReservationId = "g", ReservationId = "r", ReservationToken = "unused" });
        reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync(new Reservation
        { Id = "r", CustomerId = "owner", TableId = "t", WaiterId = "w" });
    }
    private void DeleteSetup(List<GuestSession> snapshot)
    {
        Owner();
        sessions.Setup(x => x.GetByGuestSessionId("removed")).ReturnsAsync(deleted);
        bool removed = false;
        sessions.Setup(x => x.DeleteAsync(deleted)).Callback(() => removed = true).Returns(Task.CompletedTask);
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g"))
            .Callback(() => Assert.True(removed, "Snapshot must be read after successful delete"))
            .ReturnsAsync(snapshot);
    }
    private static ILambdaContext Context()
    {
        var c = new Mock<ILambdaContext>(); c.SetupGet(x => x.Logger).Returns(Mock.Of<ILambdaLogger>()); return c.Object;
    }
    private static APIGatewayProxyRequest Request(string? group = "g", string? id = "removed", string? sub = "owner")
    {
        var request = new APIGatewayProxyRequest { PathParameters = new Dictionary<string, string>() };
        if (group != null) request.PathParameters["groupReservationId"] = group;
        if (id != null) request.PathParameters["guestSessionId"] = id;
        if (sub != null) request.RequestContext = new APIGatewayProxyRequest.ProxyRequestContext
        { Authorizer = new APIGatewayCustomAuthorizerContext { Claims = new Dictionary<string, string> { ["sub"] = sub } } };
        return request;
    }

    [Fact]
    public async Task Http_StaleDeletedRowExcluded_OriginalHomeworkSnapshotAndCamelCase()
    {
        var remaining = Guest("session2", false, "dish2", 1); remaining.GuestName = "Olena";
        DeleteSetup([deleted, remaining]);
        dishes.Setup(x => x.GetDishesByIdsAsync(It.Is<IEnumerable<string>>(ids => ids.SequenceEqual(new[] { "dish2" }))))
            .ReturnsAsync([new Dish { Id = "dish2", Name = "Tom Yum", Price = 220 }]);
        var response = await new DeleteGuestSessionHandler(Service).HandleRequest(Request(), Context());
        Assert.Equal(200, response.StatusCode);
        using var document = JsonDocument.Parse(response.Body); var root = document.RootElement;
        Assert.Equal(new[] { "participants", "total" }, root.EnumerateObject().Select(p => p.Name));
        Assert.Equal(220m, root.GetProperty("total").GetDecimal());
        var participants = root.GetProperty("participants"); Assert.Equal(1, participants.GetArrayLength());
        var p = participants[0];
        Assert.Equal(new[] { "id", "type", "name", "items", "total", "isSubmitted" }, p.EnumerateObject().Select(x => x.Name));
        Assert.Equal("session2", p.GetProperty("id").GetString());
        Assert.Equal("Guest", p.GetProperty("type").GetString());
        Assert.Equal("Olena", p.GetProperty("name").GetString());
        Assert.False(p.GetProperty("isSubmitted").GetBoolean());
        Assert.Equal(220m, p.GetProperty("total").GetDecimal());
        var item = p.GetProperty("items")[0]; Assert.Equal(1, item.GetProperty("quantity").GetInt32());
        Assert.Equal("dish2", item.GetProperty("dish").GetProperty("id").GetString());
        Assert.Equal("Tom Yum", item.GetProperty("dish").GetProperty("name").GetString());
        Assert.Equal(220m, item.GetProperty("dish").GetProperty("price").GetDecimal());
        Assert.All(item.GetProperty("dish").EnumerateObject(), field => Assert.True(char.IsLower(field.Name[0])));
        sessions.Verify(x => x.DeleteAsync(deleted), Times.Once);
        Assert.Single(remaining.Dishes); Assert.Equal(1, remaining.Dishes[0].Quantity); Assert.False(remaining.IsSubmitted);
        sessions.Verify(x => x.SaveAsync(It.IsAny<GuestSession>()), Times.Never);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LastSession_ReturnsEmptyZero_EvenIfGsiStillContainsDeletedRow(bool stale)
    {
        DeleteSetup(stale ? [deleted] : []);
        var response = await new DeleteGuestSessionHandler(Service).HandleRequest(Request(), Context());
        Assert.Equal(200, response.StatusCode);
        Assert.Equal("{\"participants\":[],\"total\":0}", response.Body);
        dishes.VerifyNoOtherCalls(); users.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Snapshot_PreservesSubmittedAndDraft_DecimalTotals_ExistingOwnerTypeAndName()
    {
        var owner = Guest("owner-session", true, "d", 3); owner.IsOwnerSession = true; owner.OwnerUserId = "owner";
        var draft = Guest("draft", false, "d", 2);
        DeleteSetup([deleted, owner, draft]);
        dishes.Setup(x => x.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([new Dish { Id = "d", Name = "Dish", Price = 0.15m }]);
        users.Setup(x => x.GetUserByIdAsync("owner")).ReturnsAsync(new UserType
        { Attributes = [new AttributeType { Name = "given_name", Value = "Owner Name" }] });
        var snapshot = await Service.DeleteGuestSessionAsync("owner", "g", "removed");
        Assert.Equal(0.75m, snapshot.Total);
        var p = snapshot.Participants.ToArray(); Assert.Equal(2, p.Length);
        Assert.Equal(0.45m, p[0].Total); Assert.Equal(ParticipantType.Owner, p[0].Type);
        Assert.Equal("Owner Name", p[0].Name); Assert.True(p[0].IsSubmitted);
        Assert.Equal(0.30m, p[1].Total); Assert.False(p[1].IsSubmitted);
        Assert.Equal(3, owner.Dishes.Single().Quantity); Assert.Equal(2, draft.Dishes.Single().Quantity);
    }

    [Theory]
    [InlineData(null, "removed", "owner", 400)]
    [InlineData(" ", "removed", "owner", 400)]
    [InlineData("g", null, "owner", 400)]
    [InlineData("g", " ", "owner", 400)]
    [InlineData("g", "removed", null, 401)]
    [InlineData("g", "removed", "", 401)]
    [InlineData("g", "removed", " ", 401)]
    public async Task Http_PathOrIdentityError_NoServiceCalls(string? group, string? id, string? user, int status)
    {
        var service = new Mock<IGuestSessionService>(MockBehavior.Strict);
        var response = await new DeleteGuestSessionHandler(service.Object).HandleRequest(Request(group, id, user), Context());
        Assert.Equal(status, response.StatusCode); service.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData("group", 404)]
    [InlineData("reservation", 404)]
    [InlineData("session", 404)]
    [InlineData("wrongGroup", 400)]
    [InlineData("owner", 403)]
    public async Task Http_RealServiceErrors_DoNotDeleteOrReadSnapshot(string failure, int status)
    {
        Owner();
        sessions.Setup(x => x.GetByGuestSessionId("removed")).ReturnsAsync(deleted);
        if (failure == "group") groups.Setup(x => x.GetGroupReservationByIdAsync("g")).ReturnsAsync((GroupReservation?)null);
        if (failure == "reservation") reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync((Reservation?)null);
        if (failure == "session") sessions.Setup(x => x.GetByGuestSessionId("removed")).ReturnsAsync((GuestSession?)null);
        if (failure == "wrongGroup") deleted.GroupReservationId = "other";
        var response = await new DeleteGuestSessionHandler(Service).HandleRequest(Request(sub: failure == "owner" ? "other" : "owner"), Context());
        Assert.Equal(status, response.StatusCode);
        sessions.Verify(x => x.DeleteAsync(It.IsAny<GuestSession>()), Times.Never);
        sessions.Verify(x => x.GetAllByGroupReservationIdAsync(It.IsAny<string>()), Times.Never);
        if (failure is "group" or "reservation" or "owner") sessions.Verify(x => x.GetByGuestSessionId(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Service_MissingIdentityCannotMatchEmptyReservationOwner()
    {
        await Assert.ThrowsAsync<ActionForbiddenException>(() => Service.DeleteGuestSessionAsync("", "g", "removed"));
        groups.VerifyNoOtherCalls(); sessions.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task DeleteFailure_DoesNotBuildSuccessSnapshot()
    {
        Owner(); sessions.Setup(x => x.GetByGuestSessionId("removed")).ReturnsAsync(deleted);
        sessions.Setup(x => x.DeleteAsync(deleted)).ThrowsAsync(new IOException("delete failed"));
        await Assert.ThrowsAsync<IOException>(() => Service.DeleteGuestSessionAsync("owner", "g", "removed"));
        sessions.Verify(x => x.GetAllByGroupReservationIdAsync(It.IsAny<string>()), Times.Never);
    }
}
