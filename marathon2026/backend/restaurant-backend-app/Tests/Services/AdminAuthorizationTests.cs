using Amazon.DynamoDBv2.DataModel;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using Amazon.S3;
using APIHandler.Entities;
using APIHandler.Handlers;
using APIHandler.Handlers.Dishes;
using APIHandler.Handlers.Locations;
using APIHandler.Handlers.Tables;
using APIHandler.Models.Dishes;
using APIHandler.Models.Locations;
using APIHandler.Models.Tables;
using APIHandler.Models.WaiterList;
using APIHandler.Services;
using APIHandler.Services.Tables;
using APIHandler.Services.Waiters;
using Moq;
using System.Text.Json;

namespace APIHandler.Tests.Services;

[CollectionDefinition("Admin authorization", DisableParallelization = true)]
public class AdminAuthorizationCollection { }

[Collection("Admin authorization")]
public class AdminAuthorizationTests : IDisposable
{
    private readonly Mock<IDynamoDBContext> database = new(MockBehavior.Strict);
    private readonly Mock<IAmazonS3> storage = new(MockBehavior.Strict);
    private readonly Mock<IWaiterService> waiters = new(MockBehavior.Strict);
    private readonly Mock<ITableService> tables = new(MockBehavior.Strict);
    private readonly Dictionary<string, string?> previous = new();

    public AdminAuthorizationTests()
    {
        foreach (var key in new[] { "locationsTable", "dishesTable", "imagesBucketName" })
        {
            previous[key] = Environment.GetEnvironmentVariable(key);
            Environment.SetEnvironmentVariable(key, "admin-test-" + key);
        }
    }
    public void Dispose()
    {
        foreach (var entry in previous) Environment.SetEnvironmentVariable(entry.Key, entry.Value);
    }

    private IApiRequestHandler Handler(int operation) => operation switch
    {
        0 => new AddWaiterHandler(waiters.Object),
        1 => new DeleteWaiterHandler(waiters.Object),
        2 => new CreateLocationHandler(database.Object, new S3ImageService(storage.Object)),
        3 => new CreateTableHandler(tables.Object),
        4 => new CreateDishHandler(database.Object, new S3ImageService(storage.Object)),
        _ => throw new ArgumentOutOfRangeException(nameof(operation)),
    };
    private static ILambdaContext Context()
    {
        var context = new Mock<ILambdaContext>();
        context.SetupGet(value => value.Logger).Returns(Mock.Of<ILambdaLogger>());
        return context.Object;
    }
    private static APIGatewayProxyRequest Request(string? subject, string? groups, string body)
    {
        var claims = new Dictionary<string, string>();
        if (subject is not null) claims["sub"] = subject;
        if (groups is not null) claims["cognito:groups"] = groups;
        return new APIGatewayProxyRequest
        {
            Body = body,
            // Neither header nor body is a trusted role source.
            Headers = new Dictionary<string, string> { ["Authorization"] = "Bearer forged-admin", ["role"] = "Admin" },
            RequestContext = new APIGatewayProxyRequest.ProxyRequestContext
            { Authorizer = new APIGatewayCustomAuthorizerContext { Claims = claims } },
        };
    }
    public static IEnumerable<object?[]> DeniedCases()
    {
        for (var operation = 0; operation < 5; operation++)
        {
            yield return [operation, null, null, 401];
            yield return [operation, " ", "Admin", 401];
            yield return [operation, null, "Admin", 401];
            foreach (var groups in new string?[] { null, "", "Customer", "Waiter", "SuperAdmin", "admin", "[\"Admin\",", "[0]", "[null]" })
                yield return [operation, "user", groups, 403];
        }
    }
    [Theory]
    [MemberData(nameof(DeniedCases))]
    public async Task Unauthorized_IsRejectedBeforeParsingOrAnyDependencyCall(int operation, string? subject, string? groups, int expected)
    {
        var response = await Handler(operation).HandleRequest(Request(subject, groups, "{invalid-json"), Context());
        Assert.Equal(expected, response.StatusCode);
        database.VerifyNoOtherCalls(); storage.VerifyNoOtherCalls(); waiters.VerifyNoOtherCalls(); tables.VerifyNoOtherCalls();
    }
    [Theory]
    [InlineData(0)] [InlineData(1)] [InlineData(2)] [InlineData(3)] [InlineData(4)]
    public async Task MissingAuthorizer_Is401(int operation)
    {
        var response = await Handler(operation).HandleRequest(new APIGatewayProxyRequest { Body = "{}", RequestContext = null }, Context());
        Assert.Equal(401, response.StatusCode);
        database.VerifyNoOtherCalls(); storage.VerifyNoOtherCalls(); waiters.VerifyNoOtherCalls(); tables.VerifyNoOtherCalls();
    }
    public static IEnumerable<object[]> AdminCases()
    {
        for (var operation = 0; operation < 5; operation++)
            foreach (var groups in new[] { "Admin", "[\"Customer\",\"Admin\"]", "Waiter, Admin" })
                yield return [operation, groups];
    }
    [Theory]
    [MemberData(nameof(AdminCases))]
    public async Task Admin_PerformsExistingOperationSuccessfully(int operation, string groups)
    {
        string body;
        if (operation < 2)
        {
            body = JsonSerializer.Serialize(new UpdateWaiterListRequest { Email = "waiter@example.com", LocationId = "location" });
            waiters.Setup(value => value.IsWaiterInListAsync("waiter@example.com")).ReturnsAsync(operation == 1);
            if (operation == 0) waiters.Setup(value => value.AddWaiterToListAsync(It.IsAny<UpdateWaiterListRequest>())).Returns(Task.CompletedTask);
            else waiters.Setup(value => value.RemoveWaiterFromListAsync("waiter@example.com")).Returns(Task.CompletedTask);
        }
        else if (operation == 2)
        {
            body = JsonSerializer.Serialize(new CreateLocationRequest { Address = "Demo address", Description = "Demo", AverageOccupancy = "50", TotalCapacity = 10 });
            database.Setup(value => value.SaveAsync(It.IsAny<Location>(), It.IsAny<SaveConfig>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        }
        else if (operation == 3)
        {
            body = JsonSerializer.Serialize(new CreateTableRequest { LocationId = "location", Capacity = 4, TableNumber = 1 });
            tables.Setup(value => value.CreateTableAsync(It.IsAny<CreateTableRequest>())).ReturnsAsync(new Table { Id = "table", LocationId = "location", Capacity = 4, TableNumber = 1 });
        }
        else
        {
            body = JsonSerializer.Serialize(new CreateDishRequest { Name = "Demo dish", Description = "Demo", Weight = "100 g", Calories = "100", Proteins = "1", Fats = "1", Carbohydrates = "1", Vitamins = "A", Price = 10, LocationIds = [] });
            database.Setup(value => value.SaveAsync(It.IsAny<Dish>(), It.IsAny<SaveConfig>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        }
        var response = await Handler(operation).HandleRequest(Request("admin-user", groups, body), Context());
        Assert.Equal(operation < 2 ? 200 : 201, response.StatusCode);
        if (operation == 0) waiters.Verify(value => value.AddWaiterToListAsync(It.IsAny<UpdateWaiterListRequest>()), Times.Once);
        if (operation == 1) waiters.Verify(value => value.RemoveWaiterFromListAsync("waiter@example.com"), Times.Once);
        if (operation == 2) database.Verify(value => value.SaveAsync(It.IsAny<Location>(), It.IsAny<SaveConfig>(), It.IsAny<CancellationToken>()), Times.Once);
        if (operation == 3) tables.Verify(value => value.CreateTableAsync(It.IsAny<CreateTableRequest>()), Times.Once);
        if (operation == 4) database.Verify(value => value.SaveAsync(It.IsAny<Dish>(), It.IsAny<SaveConfig>(), It.IsAny<CancellationToken>()), Times.Once);
        storage.VerifyNoOtherCalls();
    }
}
