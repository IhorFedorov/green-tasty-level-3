# How to generate Swagger Documentation

## Demo deployment security

Swagger is optional documentation, not an application dependency.
Terraform keeps its artifact bucket private with all public access blocked.
No S3 website or CloudFront route publishes these artifacts. Syndicate may
still upload UI/spec objects with its authorized deployment identity over HTTPS;
the bucket remains owned only by Terraform. Do not add public ACLs or policies.
The bundled spec contains a historical API URL: do not use its Try it out
against that URL. Export the actual API schema after an approved deployment
before using the documentation locally. The frontend calls the API directly.

1. Deploy application using AWS Syndicate
2. Export schema using:
```bash
syndicate export -rt api_gateway
```
3. Rename exported schema file in the `export` folder to `specs.json` and put in the root folder of backend application.
4. Generate swagger UI resource using:
```bash
syndicate generate swagger-ui --name swagger-ui --target-bucket swaggerui --path-to-spec specs.json
```
5. In the file `swagger_src/swagger_ui_config.json` change `target_bucket` value:
```patch
-"target_bucket": "swaggerui"
+"target_bucket": "${swagger_ui_hoster_bucket_name}"
```
6. Redeploy application using `syndicate deploy`.
