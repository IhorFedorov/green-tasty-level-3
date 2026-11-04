using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DataModel;
using Amazon.DynamoDBv2.Model;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Handlers.GuestSessions;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.Orders;
using APIHandler.Repositories.Reservations;
using APIHandler.Services.GuestSessions;
using Moq;
using System.Text.Json;

namespace APIHandler.Tests.Services;

public class GroupPreOrderLevel2Tests
{
    private readonly Mock<IReservationRepository> reservations = new(MockBehavior.Strict);
    private readonly Mock<IGroupReservationRepository> groups = new(MockBehavior.Strict);
    private readonly Mock<IGuestSessionRepository> sessions = new(MockBehavior.Strict);
    private readonly Mock<IOrderRepository> orders = new(MockBehavior.Strict);
    private readonly Mock<IGroupPreOrderWriter> writer = new(MockBehavior.Strict);
    private GroupPreOrderService Service => new(reservations.Object, groups.Object, sessions.Object, orders.Object, writer.Object);
    private readonly Reservation reservation = new() { Id = "r", CustomerId = "owner", TableId = "t", WaiterId = "w" };
    private readonly GroupReservation group = new() { GroupReservationId = "g", ReservationId = "r", ReservationToken = "unused" };
    private readonly Order order = new() { OrderId = "o", CustomerId = "owner", ReservationId = "r",
        ReservationAddress = "address", ReservationTime = "time", Dishes = [] };
    private static GuestSession Guest(string id, bool submitted, params (string id, int qty)[] dishes) => new()
    { Id = id, GuestName = id, GroupReservationId = "g", IsSubmitted = submitted,
      Dishes = dishes.Select(d => new OrderItem { DishId = d.id, Quantity = d.qty }).ToList() };
    private void Base()
    {
        reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync(reservation);
        groups.Setup(x => x.GetGroupReservationByIdAsync("g")).ReturnsAsync(group);
        groups.Setup(x => x.GetByReservationIdAsync("r")).ReturnsAsync(group);
    }
    private void Submitted()
    {
        Base();
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([
            Guest("one", true, ("d1", 2), ("d2", 2)), Guest("two", true, ("d1", 1)),
            Guest("draft", false, ("d1", 100))]);
        orders.Setup(x => x.GetOrderByReservationIdAsync("r")).ReturnsAsync(order);
    }

    [Fact]
    public async Task OwnerGet_StableCandidate_ForRepeatedConcurrentCallsEvenWithStaleIndex()
    {
        Base();
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([]);
        var ids = new List<string>();
        writer.Setup(x => x.EnsureOwnerAsync(It.IsAny<GuestSession>())).ReturnsAsync((GuestSession s) =>
        { ids.Add(s.Id); Assert.True(s.IsOwnerSession); Assert.Equal("owner", s.OwnerUserId); return s; });
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Service.GetOwnerSessionIdAsync("owner", "r")));
        Assert.Single(results.Distinct());
        Assert.StartsWith("owner-", results[0]);
        Assert.Single(ids.Distinct());
    }

    [Fact]
    public async Task OwnerGet_ReusesExistingLegacyOwner()
    {
        Base();
        var owner = Guest("existing", false); owner.IsOwnerSession = true; owner.OwnerUserId = "owner";
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([Guest("guest", false), owner]);
        Assert.Equal("existing", await Service.GetOwnerSessionIdAsync("owner", "r"));
        writer.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task OwnerGet_ConflictingOwners_FailsWithoutCreation()
    {
        Base();
        var owner = Guest("existing", false); owner.IsOwnerSession = true; owner.OwnerUserId = "owner";
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([owner, owner]);
        await Assert.ThrowsAsync<ValidationException>(() => Service.GetOwnerSessionIdAsync("owner", "r"));
        writer.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(GroupReservationStatus.Closed)]
    [InlineData(GroupReservationStatus.Submitted)]
    public async Task OwnerGet_DoesNotCreateInTerminalGroup(GroupReservationStatus status)
    {
        Base(); group.Status = status;
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([]);
        await Assert.ThrowsAsync<ValidationException>(() => Service.GetOwnerSessionIdAsync("owner", "r"));
        writer.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Submit_AggregatesOnlySubmitted_DoesNotMutateLoadedOrder_AndRejectsRepeat()
    {
        Submitted();
        List<OrderItem>? saved = null;
        writer.Setup(x => x.SubmitAsync(group, order, It.IsAny<List<OrderItem>>())).Returns((GroupReservation g, Order o, List<OrderItem> items) =>
        { saved = items; g.Status = GroupReservationStatus.Submitted; return Task.CompletedTask; });
        var result = await Service.SubmitAsync("owner", "g", "r");
        Assert.Equal(new[] { new ConsolidatedDish("d1", 3), new ConsolidatedDish("d2", 2) }, result);
        Assert.Equal(3, saved![0].Quantity);
        Assert.Empty(order.Dishes); // only writer owns persistence
        await Assert.ThrowsAsync<ValidationException>(() => Service.SubmitAsync("owner", "g", "r"));
        writer.Verify(x => x.SubmitAsync(group, order, It.IsAny<List<OrderItem>>()), Times.Once);
    }

    [Theory]
    [InlineData("none")]
    [InlineData("empty")]
    [InlineData("missingOrder")]
    [InlineData("invalidQuantity")]
    [InlineData("overflow")]
    [InlineData("wrongReservation")]
    [InlineData("wrongCustomer")]
    [InlineData("submittedOrder")]
    public async Task Submit_BadInputHasNoWrites(string kind)
    {
        Submitted();
        if (kind == "none") sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([Guest("draft", false, ("d", 1))]);
        if (kind == "empty") sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([Guest("s", true)]);
        if (kind == "invalidQuantity") sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([Guest("s", true, ("d", 0))]);
        if (kind == "overflow") sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([Guest("s", true, ("d", int.MaxValue), ("d", 1))]);
        if (kind == "missingOrder") orders.Setup(x => x.GetOrderByReservationIdAsync("r")).ReturnsAsync((Order?)null);
        if (kind == "wrongReservation") group.ReservationId = "other";
        if (kind == "wrongCustomer") order.CustomerId = "other";
        if (kind == "submittedOrder") order.Status = OrderStatus.SubmittedByCustomer;
        await Assert.ThrowsAsync<ValidationException>(() => Service.SubmitAsync("owner", "g", "r"));
        writer.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task BothEndpoints_RejectNonOwnerBeforeSessionReads(bool submit)
    {
        Base();
        if (submit) await Assert.ThrowsAsync<ActionForbiddenException>(() => Service.SubmitAsync("other", "g", "r"));
        else await Assert.ThrowsAsync<ActionForbiddenException>(() => Service.GetOwnerSessionIdAsync("other", "r"));
        sessions.VerifyNoOtherCalls(); writer.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task BothEndpoints_MissingReservationOrGroup(bool submit, bool missingGroup)
    {
        Base();
        if (missingGroup)
        {
            groups.Setup(x => x.GetByReservationIdAsync("r")).ReturnsAsync((GroupReservation?)null);
            groups.Setup(x => x.GetGroupReservationByIdAsync("g")).ReturnsAsync((GroupReservation?)null);
            if (submit) await Assert.ThrowsAsync<GroupReservationNotFoundException>(() => Service.SubmitAsync("owner", "g", "r"));
            else await Assert.ThrowsAsync<GroupReservationNotFoundException>(() => Service.GetOwnerSessionIdAsync("owner", "r"));
        }
        else
        {
            reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync((Reservation?)null);
            if (submit) await Assert.ThrowsAsync<ReservationNotFoundException>(() => Service.SubmitAsync("owner", "g", "r"));
            else await Assert.ThrowsAsync<ReservationNotFoundException>(() => Service.GetOwnerSessionIdAsync("owner", "r"));
        }
        writer.VerifyNoOtherCalls();
    }

    private static ILambdaContext Context()
    {
        var c = new Mock<ILambdaContext>(); c.SetupGet(x => x.Logger).Returns(Mock.Of<ILambdaLogger>()); return c.Object;
    }
    private static APIGatewayProxyRequest Request(bool submit, string? user = "owner", string? body = "{\"reservationId\":\"r\"}") => new()
    {
        PathParameters = new Dictionary<string, string>() { [submit ? "groupReservationId" : "reservationId"] = submit ? "g" : "r" }, Body = body,
        RequestContext = user == null ? null : new APIGatewayProxyRequest.ProxyRequestContext
        { Authorizer = new APIGatewayCustomAuthorizerContext { Claims = new Dictionary<string, string> { ["sub"] = user } } }
    };
    private Task<APIGatewayProxyResponse> Handle(bool submit, APIGatewayProxyRequest request) => submit
        ? new SubmitGroupPreOrderHandler(Service).HandleRequest(request, Context())
        : new GetOwnerSessionIdHandler(Service).HandleRequest(request, Context());

    [Fact]
    public async Task Handlers_ExactCamelCaseContracts()
    {
        Submitted();
        writer.Setup(x => x.SubmitAsync(group, order, It.IsAny<List<OrderItem>>())).Returns(Task.CompletedTask);
        var response = await Handle(true, Request(true));
        Assert.Equal(200, response.StatusCode);
        using var json = JsonDocument.Parse(response.Body);
        Assert.Equal(2, json.RootElement.GetArrayLength());
        Assert.Equal(new[] { "dishId", "quantity" }, json.RootElement[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal(3, json.RootElement[0].GetProperty("quantity").GetInt32());
        var owner = Guest("owner-id", false); owner.IsOwnerSession = true; owner.OwnerUserId = "owner";
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([owner]);
        response = await Handle(false, Request(false));
        Assert.Equal(200, response.StatusCode);
        Assert.Equal("{\"guestSessionId\":\"owner-id\"}", response.Body);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Handlers_PathAndIdentityErrors(bool submit)
    {
        Assert.Equal(401, (await Handle(submit, Request(submit, null))).StatusCode);
        Assert.Equal(401, (await Handle(submit, Request(submit, " "))).StatusCode);
        var request = Request(submit); request.PathParameters.Clear();
        Assert.Equal(400, (await Handle(submit, request)).StatusCode);
        writer.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("{")]
    [InlineData("{}")]
    [InlineData("{\"reservationId\":3}")]
    public async Task SubmitHandler_BadBody400(string? body)
    {
        Assert.Equal(400, (await Handle(true, Request(true, body: body))).StatusCode);
        writer.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task SubmitHandler_UnexpectedFailure500_NoFallbackSaves()
    {
        Submitted(); writer.Setup(x => x.SubmitAsync(group, order, It.IsAny<List<OrderItem>>())).ThrowsAsync(new IOException("private failure"));
        var response = await Handle(true, Request(true));
        Assert.Equal(500, response.StatusCode); Assert.DoesNotContain("private failure", response.Body);
        orders.Verify(x => x.SaveOrderAsync(It.IsAny<Order>()), Times.Never);
        groups.Verify(x => x.SaveGroupReservationAsync(It.IsAny<GroupReservation>()), Times.Never);
    }

    [Fact]
    public async Task Writer_SendsOneConditionalTransactionForBothRecords()
    {
        Environment.SetEnvironmentVariable("groupReservationsTable", "test-groups");
        Environment.SetEnvironmentVariable("ordersTable", "test-orders");
        var client = new Mock<IAmazonDynamoDB>(MockBehavior.Strict);
        TransactWriteItemsRequest? captured = null;
        client.Setup(x => x.TransactWriteItemsAsync(It.IsAny<TransactWriteItemsRequest>(), It.IsAny<CancellationToken>()))
            .Callback<TransactWriteItemsRequest, CancellationToken>((r, _) => captured = r)
            .ReturnsAsync(new TransactWriteItemsResponse());
        await new GroupPreOrderWriter(client.Object, Mock.Of<IDynamoDBContext>()).SubmitAsync(group, order,
            [new OrderItem { DishId = "d", Quantity = 3 }]);
        Assert.Equal(2, captured!.TransactItems.Count);
        Assert.All(captured.TransactItems, t => Assert.NotNull(t.Update));
        var g = captured.TransactItems[0].Update; var o = captured.TransactItems[1].Update;
        Assert.Equal("g", g.Key["groupReservationId"].S);
        Assert.Equal("o", o.Key["orderId"].S); Assert.Equal("owner", o.Key["customerId"].S);
        Assert.Contains("#status = :open", g.ConditionExpression);
        Assert.Contains("dishes = :previous", o.ConditionExpression);
        Assert.Equal(((int)GroupReservationStatus.Submitted).ToString(), g.ExpressionAttributeValues[":submitted"].N);
        Assert.Equal(((int)OrderStatus.SubmittedByCustomer).ToString(), o.ExpressionAttributeValues[":submitted"].N);
        Assert.Equal("3", o.ExpressionAttributeValues[":items"].L[0].M["quantity"].N);
        Assert.DoesNotContain(captured.TransactItems, t => t.ConditionCheck != null);
        client.Verify(x => x.TransactWriteItemsAsync(It.IsAny<TransactWriteItemsRequest>(), It.IsAny<CancellationToken>()), Times.Once);
        client.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData("ConditionalCheckFailed", true)]
    [InlineData("TransactionConflict", false)]
    [InlineData("ProvisionedThroughputExceeded", false)]
    public async Task Writer_TransactionFailureIsNotReportedAsSuccess(string code, bool validation)
    {
        var client = new Mock<IAmazonDynamoDB>();
        client.Setup(x => x.TransactWriteItemsAsync(It.IsAny<TransactWriteItemsRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new TransactionCanceledException("failed")
            { CancellationReasons = [new CancellationReason { Code = code }, new CancellationReason { Code = "None" }] });
        Environment.SetEnvironmentVariable("groupReservationsTable", "test-groups"); Environment.SetEnvironmentVariable("ordersTable", "test-orders");
        var w = new GroupPreOrderWriter(client.Object, Mock.Of<IDynamoDBContext>());
        if (validation) await Assert.ThrowsAsync<ValidationException>(() => w.SubmitAsync(group, order, []));
        else await Assert.ThrowsAsync<TransactionCanceledException>(() => w.SubmitAsync(group, order, []));
    }

    [Fact]
    public async Task OwnerWriter_ConditionalRaceReturnsWinnerWithoutOverwritingDishes()
    {
        Environment.SetEnvironmentVariable("guestSessionTable", "test-guests");
        var candidate = Guest("stable", false); candidate.IsOwnerSession = true; candidate.OwnerUserId = "owner";
        var winner = Guest("stable", true, ("d", 7)); winner.IsOwnerSession = true; winner.OwnerUserId = "owner";
        var context = new Mock<IDynamoDBContext>(MockBehavior.Strict);
        context.SetupSequence(x => x.LoadAsync<GuestSession?>("stable", It.IsAny<LoadConfig>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((GuestSession?)null).ReturnsAsync(winner);
        var client = new Mock<IAmazonDynamoDB>(MockBehavior.Strict);
        PutItemRequest? put = null;
        client.Setup(x => x.PutItemAsync(It.IsAny<PutItemRequest>(), It.IsAny<CancellationToken>()))
            .Callback<PutItemRequest, CancellationToken>((r, _) => put = r)
            .ThrowsAsync(new ConditionalCheckFailedException("other request won"));
        var result = await new GroupPreOrderWriter(client.Object, context.Object).EnsureOwnerAsync(candidate);
        Assert.Same(winner, result);
        Assert.True(result.IsSubmitted); Assert.Equal(7, result.Dishes.Single().Quantity);
        Assert.Equal("attribute_not_exists(guestSessionId)", put!.ConditionExpression);
        Assert.True(put.Item["isOwnerSession"].BOOL);
        context.Verify(x => x.LoadAsync<GuestSession?>("stable", It.Is<LoadConfig>(c => c.ConsistentRead == true), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task OwnerWriter_ExistingSessionIsReadOnlyAndCollisionRejected()
    {
        Environment.SetEnvironmentVariable("guestSessionTable", "test-guests");
        var candidate = Guest("stable", false); candidate.IsOwnerSession = true; candidate.OwnerUserId = "owner";
        var context = new Mock<IDynamoDBContext>();
        context.Setup(x => x.LoadAsync<GuestSession?>("stable", It.IsAny<LoadConfig>(), It.IsAny<CancellationToken>())).ReturnsAsync(candidate);
        var client = new Mock<IAmazonDynamoDB>(MockBehavior.Strict);
        var w = new GroupPreOrderWriter(client.Object, context.Object);
        Assert.Same(candidate, await w.EnsureOwnerAsync(candidate));
        var wrong = Guest("stable", false);
        context.Setup(x => x.LoadAsync<GuestSession?>("stable", It.IsAny<LoadConfig>(), It.IsAny<CancellationToken>())).ReturnsAsync(wrong);
        await Assert.ThrowsAsync<ValidationException>(() => w.EnsureOwnerAsync(candidate));
        client.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Handlers_MapMissingAndForbidden(bool submit)
    {
        Base();
        Assert.Equal(403, (await Handle(submit, Request(submit, "other"))).StatusCode);
        reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync((Reservation?)null);
        Assert.Equal(404, (await Handle(submit, Request(submit))).StatusCode);
        reservations.Setup(x => x.GetReservationByIdAsync("r")).ReturnsAsync(reservation);
        groups.Setup(x => x.GetByReservationIdAsync("r")).ReturnsAsync((GroupReservation?)null);
        groups.Setup(x => x.GetGroupReservationByIdAsync("g")).ReturnsAsync((GroupReservation?)null);
        Assert.Equal(404, (await Handle(submit, Request(submit))).StatusCode);
    }

    [Fact]
    public async Task OwnerPresence_DoesNotCountExtraSeatInStatus()
    {
        var owner = Guest("owner-session", false); owner.IsOwnerSession = true; owner.OwnerUserId = "owner";
        Base();
        sessions.Setup(x => x.GetAllByGroupReservationIdAsync("g")).ReturnsAsync([owner, Guest("guest", false)]);
        var service = new GuestSessionService(groups.Object, sessions.Object,
            Mock.Of<APIHandler.Repositories.Dishes.IDishRepository>(), reservations.Object,
            Mock.Of<APIHandler.Repositories.Auth.IUserRepository>(), Mock.Of<APIHandler.Repositories.Tables.ITableRepository>());
        Assert.Equal(2, (await service.GetGroupReservationStatusAsync("g")).CurrentParticipants);
    }


    [Fact]
    public async Task OwnerWriter_CreatesOnce_ThenReusesWithoutOverwriting()
    {
        Environment.SetEnvironmentVariable("guestSessionTable", "test-guests");
        var candidate = Guest("stable", false); candidate.IsOwnerSession = true; candidate.OwnerUserId = "owner";
        GuestSession? stored = null;
        var context = new Mock<IDynamoDBContext>();
        context.Setup(x => x.LoadAsync<GuestSession?>("stable", It.IsAny<LoadConfig>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => stored);
        var client = new Mock<IAmazonDynamoDB>(MockBehavior.Strict);
        client.Setup(x => x.PutItemAsync(It.IsAny<PutItemRequest>(), It.IsAny<CancellationToken>()))
            .Callback<PutItemRequest, CancellationToken>((r, _) =>
            {
                Assert.Equal("test-guests", r.TableName);
                Assert.Equal("owner", r.Item["ownerUserId"].S);
                Assert.Equal("g", r.Item["groupReservationId"].S);
                Assert.True(r.Item["dishes"].IsLSet);
                Assert.Empty(r.Item["dishes"].L);
                stored = candidate;
            }).ReturnsAsync(new PutItemResponse());
        var w = new GroupPreOrderWriter(client.Object, context.Object);
        Assert.Equal("stable", (await w.EnsureOwnerAsync(candidate)).Id);
        stored!.IsSubmitted = true;
        Assert.True((await w.EnsureOwnerAsync(candidate)).IsSubmitted);
        client.Verify(x => x.PutItemAsync(It.IsAny<PutItemRequest>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Writer_ParallelSubmit_PropagatesLosingConditionalCommit()
    {
        Environment.SetEnvironmentVariable("groupReservationsTable", "test-groups");
        Environment.SetEnvironmentVariable("ordersTable", "test-orders");
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        int arrivals = 0, committed = 0;
        var client = new Mock<IAmazonDynamoDB>();
        // Simulates DynamoDB conditional transaction outcomes; not a live atomicity test.
        client.Setup(x => x.TransactWriteItemsAsync(It.IsAny<TransactWriteItemsRequest>(), It.IsAny<CancellationToken>()))
            .Returns<TransactWriteItemsRequest, CancellationToken>(async (r, _) =>
            {
                Assert.Equal(2, r.TransactItems.Count);
                if (Interlocked.Increment(ref arrivals) == 2) gate.SetResult();
                await gate.Task.WaitAsync(TimeSpan.FromSeconds(5));
                if (Interlocked.CompareExchange(ref committed, 1, 0) == 0) return new TransactWriteItemsResponse();
                throw new TransactionCanceledException("already committed")
                { CancellationReasons = [new CancellationReason { Code = "ConditionalCheckFailed" }, new CancellationReason { Code = "None" }] };
            });
        var w = new GroupPreOrderWriter(client.Object, Mock.Of<IDynamoDBContext>());
        async Task<bool> Submit()
        {
            try { await w.SubmitAsync(group, order, [new OrderItem { DishId = "d", Quantity = 3 }]); return true; }
            catch (ValidationException) { return false; }
        }
        var outcomes = await Task.WhenAll(Submit(), Submit());
        Assert.Single(outcomes.Where(x => x)); Assert.Single(outcomes.Where(x => !x));
        Assert.Equal(1, committed);
    }

}
