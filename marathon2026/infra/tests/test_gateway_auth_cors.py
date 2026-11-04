"""Offline API payload/metadata tests; no AWS clients or credential resolution."""
import json
from pathlib import Path
import unittest
import botocore.session
from botocore.validate import validate_parameters

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / 'marathon2026/backend/restaurant-backend-app'


class GatewayAuthCorsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payloads = json.loads((BACKEND / 'docs/gateway-auth-cors.json').read_text())
        cls.api = json.loads((BACKEND / 'deployment_resources.json').read_text())['${api_gateway_name}']

    def test_native_aws_update_schema(self):
        shape = botocore.session.get_session().get_service_model('apigateway').operation_model('UpdateGatewayResponse').input_shape
        for request in self.payloads:
            validate_parameters(request, shape)
            self.assertEqual(request['restApiId'], '2v8o0dlq2g')

    def test_only_targeted_auth_responses_preserve_status(self):
        self.assertEqual(len(self.payloads), 2)
        self.assertEqual({p['responseType'] for p in self.payloads}, {'UNAUTHORIZED', 'ACCESS_DENIED'})
        for request in self.payloads:
            status = '401' if request['responseType'] == 'UNAUTHORIZED' else '403'
            self.assertEqual(request['patchOperations'][0], {'op': 'replace', 'path': '/statusCode', 'value': status})

    def test_exact_origin_and_minimal_headers(self):
        for request in self.payloads:
            self.assertEqual(len(request['patchOperations']), 2)
            self.assertEqual(request['patchOperations'][1], {
                'op': 'add',
                'path': '/responseParameters/gatewayresponse.header.Access-Control-Allow-Origin',
                'value': "'https://d14f8spjgetu2u.cloudfront.net'",
            })

    def test_no_auth_reflection_or_status_success_override(self):
        text = json.dumps(self.payloads)
        for forbidden in ['*', '$context', 'method.request', 'Authorization', 'Allow-Credentials', 'Set-Cookie', 'responseTemplates', '200', 'idToken', 'accessToken']:
            self.assertNotIn(forbidden, text)

    def test_protected_routes_keep_cognito_and_preflight(self):
        expected = {
            '/waiters': ['POST', 'DELETE'], '/locations': ['POST'],
            '/tables': ['POST'], '/dishes': ['POST'],
            '/guest/groups/{groupReservationId}/sessions': ['GET'],
            '/guest/groups/{groupReservationId}/sessions/{guestSessionId}': ['DELETE'],
            '/reservations/{reservationId}/guest-session-id': ['GET'],
            '/group-reservations/{groupReservationId}/submit': ['POST'],
        }
        for route, methods in expected.items():
            resource = self.api['resources'][route]
            self.assertTrue(resource['enable_cors']['state'])
            for method in methods:
                self.assertEqual(resource[method]['authorization_type'], 'cognito_authorizer')
        self.assertTrue(self.api['resources']['/signin']['enable_cors']['state'])
        self.assertEqual(self.api['deploy_stage'], 'develop')


if __name__ == '__main__':
    unittest.main()
