"""Offline Swagger exposure checks; no cloud/runtime guarantee."""
import json
import unittest
from test_images_cdn import ROOT, TF, resource


class SwaggerPrivateTests(unittest.TestCase):
    def test_all_public_access_is_blocked(self):
        block = resource((TF / 's3.tf').read_text(), 'aws_s3_bucket_public_access_block', 'swagger_ui')
        for key in ('block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'):
            self.assertRegex(block, key + r'\s*=\s*true')

    def test_no_website_or_public_allow(self):
        text = (TF / 's3.tf').read_text()
        self.assertNotIn('resource "aws_s3_bucket_website_configuration" "swagger_ui"', text)
        block = resource(text, 'aws_s3_bucket_policy', 'swagger_ui')
        self.assertNotIn('"Allow"', block)
        self.assertIn('"Deny"', block)
        self.assertIn('"aws:SecureTransport" = "false"', block)
        self.assertIn('aws_s3_bucket.swagger_ui.arn', block)
        self.assertNotIn('swagger', (TF / 'cloudfront.tf').read_text().lower())

    def test_upload_configuration_retained_and_single_bucket_owner(self):
        backend = ROOT / 'marathon2026/backend/restaurant-backend-app'
        config = json.loads((backend / 'swagger_src/swagger-ui/swagger_ui_config.json').read_text())
        self.assertEqual(config['target_bucket'], '${swagger_ui_hoster_bucket_name}')
        self.assertTrue((backend / config['path_to_spec']).is_file())
        metadata = json.loads((backend / 'deployment_resources.json').read_text())
        for name, value in metadata.items():
            if isinstance(value, dict) and value.get('resource_type') == 's3_bucket':
                self.assertNotIn('swagger', name.lower())

    def test_frontend_has_no_swagger_runtime_reference(self):
        for path in (ROOT / 'marathon2026/frontend/restaurant-frontend-app/src').rglob('*'):
            if path.suffix in ('.ts', '.html', '.json'):
                self.assertNotIn('swagger', path.read_text().lower(), str(path))
