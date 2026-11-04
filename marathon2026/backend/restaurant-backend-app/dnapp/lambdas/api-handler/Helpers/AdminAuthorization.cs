using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Models.Users;
using System;
using System.Linq;

namespace APIHandler.Helpers;

public static class AdminAuthorization
{
    // Claims must come from the configured Cognito authorizer, never request headers/body.
    public static APIGatewayProxyResponse? RequireAdmin(APIGatewayProxyRequest request, ILambdaContext context)
    {
        var claims = request.RequestContext?.Authorizer?.Claims;
        if (claims is null || !claims.TryGetValue("sub", out var subject) || string.IsNullOrWhiteSpace(subject))
            return ResponseBuilder.CreateErrorResponse(401, "Authentication required.", context.Logger);

        if (!claims.TryGetValue("cognito:groups", out var groups) ||
            !RoleHelper.ParseRoles(groups?.Trim()).Contains(Roles.Admin.ToString(), StringComparer.Ordinal))
            return ResponseBuilder.CreateErrorResponse(403, "Admin role required.", context.Logger);

        return null;
    }
}
