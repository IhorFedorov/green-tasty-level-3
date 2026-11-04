using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Exceptions;
using APIHandler.Helpers;
using APIHandler.Services.GuestSessions;
using System;
using System.Text.Json;
using System.Threading.Tasks;

namespace APIHandler.Handlers.GuestSessions;

public class GetOwnerSessionIdHandler(GroupPreOrderService service) : IApiRequestHandler
{
    public Task<APIGatewayProxyResponse> HandleRequest(APIGatewayProxyRequest request, ILambdaContext context) =>
        Level2Response.Handle(request, context, "reservationId", async (user, id) =>
            new { guestSessionId = await service.GetOwnerSessionIdAsync(user, id) });
}

public class SubmitGroupPreOrderHandler(GroupPreOrderService service) : IApiRequestHandler
{
    private record SubmitRequest(string ReservationId);
    public Task<APIGatewayProxyResponse> HandleRequest(APIGatewayProxyRequest request, ILambdaContext context) =>
        Level2Response.Handle(request, context, "groupReservationId", async (user, id) =>
        {
            SubmitRequest? body;
            try
            {
                body = JsonSerializer.Deserialize<SubmitRequest>(request.Body ?? "", new JsonSerializerOptions
                { PropertyNameCaseInsensitive = true });
            }
            catch (JsonException) { throw new ValidationException("Invalid request body."); }
            if (body == null || string.IsNullOrWhiteSpace(body.ReservationId))
                throw new ValidationException("Missing reservationId.");
            return await service.SubmitAsync(user, id, body.ReservationId);
        });
}

internal static class Level2Response
{
    internal static async Task<APIGatewayProxyResponse> Handle(APIGatewayProxyRequest request, ILambdaContext context,
        string pathKey, Func<string, string, Task<object>> action)
    {
        if (!request.TryGetPathValue(pathKey, out var id) || string.IsNullOrWhiteSpace(id))
            return ResponseBuilder.CreateErrorResponse(400, "Missing path parameter.", context.Logger);
        if (request.RequestContext?.Authorizer?.Claims == null ||
            !request.RequestContext.Authorizer.Claims.TryGetValue("sub", out var user) || string.IsNullOrWhiteSpace(user))
            return ResponseBuilder.CreateErrorResponse(401, "Unauthorized.", context.Logger);
        try { return ResponseBuilder.CreateJsonResponse(200, await action(user, id)); }
        catch (ReservationNotFoundException ex) { return ResponseBuilder.CreateErrorResponse(404, ex.Message, context.Logger); }
        catch (GroupReservationNotFoundException ex) { return ResponseBuilder.CreateErrorResponse(404, ex.Message, context.Logger); }
        catch (ActionForbiddenException ex) { return ResponseBuilder.CreateErrorResponse(403, ex.Message, context.Logger); }
        catch (ValidationException ex) { return ResponseBuilder.CreateErrorCodeResponse(ex); }
        catch (Exception) { return ResponseBuilder.CreateErrorResponse(500, "Unable to complete request; reload before retrying.", context.Logger); }
    }
}
