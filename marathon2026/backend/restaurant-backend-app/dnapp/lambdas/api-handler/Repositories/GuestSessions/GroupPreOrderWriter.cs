using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Amazon.DynamoDBv2.DataModel;
using APIHandler.Constants;
using APIHandler.Entities;
using APIHandler.Exceptions;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;

namespace APIHandler.Repositories.GuestSessions;

// Coordinates only the writes owned by Level 2, not the GuestSessions snapshot.
public class GroupPreOrderWriter(IAmazonDynamoDB client, IDynamoDBContext context) : IGroupPreOrderWriter
{
    internal static AttributeValue S(string value) => new() { S = value };
    internal static AttributeValue N(int value) => new() { N = value.ToString(CultureInfo.InvariantCulture) };
    internal static AttributeValue Items(IEnumerable<OrderItem> items) => new()
    {
        IsLSet = true,
        L = items.Select(i => new AttributeValue { M = new Dictionary<string, AttributeValue>
        {
            ["dishId"] = S(i.DishId), ["quantity"] = N(i.Quantity), ["state"] = N((int)i.State)
        } }).ToList()
    };

    public async Task<GuestSession> EnsureOwnerAsync(GuestSession candidate)
    {
        var existing = await LoadOwnerAsync(candidate.Id);
        if (existing != null) return ValidateOwner(existing, candidate);
        try
        {
            await client.PutItemAsync(new PutItemRequest
            {
                TableName = ResourceNames.GuestSessionTableName,
                ConditionExpression = "attribute_not_exists(guestSessionId)",
                Item = new Dictionary<string, AttributeValue>
                {
                    ["guestSessionId"] = S(candidate.Id), ["groupReservationId"] = S(candidate.GroupReservationId),
                    ["guestName"] = S(candidate.GuestName), ["ownerUserId"] = S(candidate.OwnerUserId!),
                    ["isOwnerSession"] = new() { BOOL = true }, ["isSubmitted"] = new() { BOOL = false },
                    ["dishes"] = Items(candidate.Dishes)
                }
            });
            return candidate;
        }
        catch (ConditionalCheckFailedException)
        {
            return ValidateOwner(await LoadOwnerAsync(candidate.Id)
                ?? throw new ValidationException("Owner session changed; retry the request."), candidate);
        }
    }

    private Task<GuestSession?> LoadOwnerAsync(string id) => context.LoadAsync<GuestSession?>(id,
        new LoadConfig { OverrideTableName = ResourceNames.GuestSessionTableName, ConsistentRead = true });

    private static GuestSession ValidateOwner(GuestSession existing, GuestSession candidate)
    {
        if (!existing.IsOwnerSession || existing.OwnerUserId != candidate.OwnerUserId ||
            existing.GroupReservationId != candidate.GroupReservationId)
            throw new ValidationException("Conflicting owner session; manual review required.");
        return existing;
    }

    public async Task SubmitAsync(GroupReservation group, Order order, List<OrderItem> items)
    {
        try
        {
            await client.TransactWriteItemsAsync(new TransactWriteItemsRequest
            {
                ClientRequestToken = Guid.NewGuid().ToString(),
                TransactItems = new List<TransactWriteItem>
                {
                    new() { Update = new Update
                    {
                        TableName = ResourceNames.GroupReservationsTableName,
                        Key = new() { ["groupReservationId"] = S(group.GroupReservationId) },
                        UpdateExpression = "SET #status = :submitted",
                        ConditionExpression = "attribute_exists(groupReservationId) AND reservationId = :reservation AND #status = :open",
                        ExpressionAttributeNames = new() { ["#status"] = "status" },
                        ExpressionAttributeValues = new()
                        {
                            [":reservation"] = S(group.ReservationId), [":open"] = N((int)GroupReservationStatus.Open),
                            [":submitted"] = N((int)GroupReservationStatus.Submitted)
                        }
                    } },
                    new() { Update = new Update
                    {
                        TableName = ResourceNames.OrdersTableName,
                        Key = new() { ["orderId"] = S(order.OrderId), ["customerId"] = S(order.CustomerId) },
                        UpdateExpression = "SET #status = :submitted, dishes = :items",
                        ConditionExpression = "attribute_exists(orderId) AND reservationId = :reservation AND #status = :created AND dishes = :previous",
                        ExpressionAttributeNames = new() { ["#status"] = "status" },
                        ExpressionAttributeValues = new()
                        {
                            [":reservation"] = S(group.ReservationId), [":created"] = N((int)OrderStatus.Created),
                            [":submitted"] = N((int)OrderStatus.SubmittedByCustomer), [":items"] = Items(items),
                            [":previous"] = Items(order.Dishes)
                        }
                    } }
                }
            });
        }
        catch (TransactionCanceledException ex) when (ex.CancellationReasons != null &&
            ex.CancellationReasons.Any(r => r.Code == "ConditionalCheckFailed") &&
            ex.CancellationReasons.All(r => r.Code == "None" || r.Code == "ConditionalCheckFailed"))
        {
            throw new ValidationException("Group or order changed or was already submitted; reload before retrying.");
        }
    }
}
