#!/bin/bash
# Crea el bucket, la cola y la DLQ en LocalStack para desarrollo local.
set -euo pipefail

awslocal s3 mb s3://driveclone-storage

DLQ_URL=$(awslocal sqs create-queue --queue-name driveclone-jobs-dlq \
  --attributes MessageRetentionPeriod=1209600 --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

awslocal sqs create-queue --queue-name driveclone-jobs --attributes "{
  \"VisibilityTimeout\": \"30\",
  \"MessageRetentionPeriod\": \"86400\",
  \"ReceiveMessageWaitTimeSeconds\": \"10\",
  \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
}"

echo "driveclone: bucket y colas listos"
