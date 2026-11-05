using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Constants;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Handlers.GroupReservations;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Reservations;
using APIHandler.Repositories.Tables;
using APIHandler.Services.Auth;
using APIHandler.Services.GroupReservations;
using APIHandler.Services.Locations;
using Moq;

namespace APIHandler.Tests.Services;

public class InviteOwnerAccessTests
{
    private readonly Mock<IReservationRepository> reservations = new(MockBehavior.Strict);
    private readonly Mock<IGroupReservationRepository> groups = new(MockBehavior.Strict);
    private readonly Mock<IGuestSessionRepository> sessions = new(MockBehavior.Strict);
    private readonly Mock<ITableRepository> tables = new(MockBehavior.Strict);
    private readonly Mock<IUserService> users = new(MockBehavior.Strict);
    private readonly Mock<ILocationService> locations = new(MockBehavior.Strict);
    private GroupReservationService Service => new(groups.Object, tables.Object, reservations.Object,
        sessions.Object, users.Object, locations.Object);
    private readonly Reservation reservation = new() { Id = "r", CustomerId = "owner", TableId = "t",
        WaiterId = "w", GuestCount = 4, Status = ReservationStatus.Reserved };
    private readonly GroupReservation group = new() { GroupReservationId = "g", ReservationId = "r",
        ReservationToken = "existing-token", Status = GroupReservationStatus.Open };

    public InviteOwnerAccessTests()
    {
        reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync(reservation);
        groups.Setup(x => x.GetByReservationIdAsync("r")).ReturnsAsync(group);
    }

    [Fact]
    public async Task OwnerRepeatedRetrievalReusesExistingTokenAndPerformsOnlyReads()
    {
        Assert.Equal("existing-token", (await Service.GetGroupReservationInviteTokenAsync("r", "owner")).Token);
        Assert.Equal("existing-token", (await Service.GetGroupReservationInviteTokenAsync("r", "owner")).Token);
        reservations.Verify(x => x.GetReservationByIdAsync("r"), Times.Exactly(2)); reservations.VerifyNoOtherCalls();
        groups.Verify(x => x.GetByReservationIdAsync("r"), Times.Exactly(2)); groups.VerifyNoOtherCalls();
        sessions.VerifyNoOtherCalls(); tables.VerifyNoOtherCalls(); users.VerifyNoOtherCalls(); locations.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task NonOwnerIsDeniedBeforeEligibilityOrTokenLookup()
    {
        reservation.GuestCount = 1; reservation.Status = ReservationStatus.Cancelled;
        await Assert.ThrowsAsync<ActionForbiddenException>(() => Service.GetGroupReservationInviteTokenAsync("r", "other"));
        groups.VerifyNoOtherCalls(); sessions.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task MissingIdentityIsDeniedWithoutReadingReservation()
    {
        await Assert.ThrowsAsync<ActionForbiddenException>(() => Service.GetGroupReservationInviteTokenAsync("r", ""));
        reservations.VerifyNoOtherCalls(); groups.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task MissingGroupNeverCreatesOrRepairsIt()
    {
        groups.Setup(x => x.GetByReservationIdAsync("r")).ReturnsAsync((GroupReservation?)null);
        await Assert.ThrowsAsync<GroupReservationNotFoundException>(() => Service.GetGroupReservationInviteTokenAsync("r", "owner"));
        groups.Verify(x => x.GetByReservationIdAsync("r"), Times.Once); groups.VerifyNoOtherCalls();
        sessions.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData("parent")]
    [InlineData("unknown")]
    public async Task InconsistentGroupNeverReturnsToken(string change)
    {
        if (change == "parent") group.ReservationId = "other";
        if (change == "unknown") group.Status = (GroupReservationStatus)999;
        await Assert.ThrowsAsync<ValidationException>(() => Service.GetGroupReservationInviteTokenAsync("r", "owner"));
    }

    private static APIGatewayProxyRequest Request(string? user) => new()
    {
        PathParameters = new Dictionary<string, string> { ["reservationId"] = "r" },
        RequestContext = new() { Authorizer = new() { Claims = user == null ? new() : new() { ["sub"] = user } } }
    };
    private static ILambdaContext Context()
    {
        var context = new Mock<ILambdaContext>(); context.SetupGet(x => x.Logger).Returns(Mock.Of<ILambdaLogger>());
        return context.Object;
    }

    [Theory]
    [InlineData(null, 401)]
    [InlineData("", 401)]
    [InlineData("other", 403)]
    [InlineData("owner", 200)]
    public async Task HandlerUsesTrustedClaimsAndDoesNotLeakTokenOnDenial(string? user, int status)
    {
        var result = await new GetInviteTokenHandler(Service).HandleRequest(Request(user), Context());
        Assert.Equal(status, result.StatusCode);
        if (status != 200) Assert.DoesNotContain("existing-token", result.Body);
        if (status == 401) reservations.VerifyNoOtherCalls();
        if (status != 200) groups.VerifyNoOtherCalls();
        sessions.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task MissingAuthorizerDoesNotCallService()
    {
        var service = new Mock<IGroupReservationService>(MockBehavior.Strict);
        var request = Request(null); request.RequestContext = null;
        Assert.Equal(401, (await new GetInviteTokenHandler(service.Object).HandleRequest(request, Context())).StatusCode);
        service.VerifyNoOtherCalls();
    }
}
