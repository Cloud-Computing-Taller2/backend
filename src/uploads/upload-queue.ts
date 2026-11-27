import { Inject, Injectable } from '@nestjs/common';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { APP_CONFIG, SQS_CLIENT } from '../infra/infra.module';
import type { AppConfig } from '../infra/config';

/** Contenido del mensaje en la cola. */
export interface UploadJob {
  fileId: string;
}

export interface ReceivedJob {
  job: UploadJob | null;
  receiptHandle: string;
  receiveCount: number;
  messageId: string;
}

@Injectable()
export class UploadQueue {
  private readonly queueUrl: string;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.queueUrl = config.sqsQueueUrl;
  }

  async publish(job: UploadJob): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(job),
      }),
    );
  }

  async receive(max: number, waitSeconds = 10): Promise<ReceivedJob[]> {
    const res = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: max,
        WaitTimeSeconds: waitSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    return (res.Messages ?? []).map((m) => toReceivedJob(m));
  }

  async ack(receiptHandle: string): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  /** Cambia el visibility timeout del mensaje. */
  async setVisibility(receiptHandle: string, seconds: number): Promise<void> {
    await this.sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }
}

function toReceivedJob(m: Message): ReceivedJob {
  let job: UploadJob | null = null;
  try {
    const parsed = JSON.parse(m.Body ?? '') as Partial<UploadJob>;
    if (typeof parsed.fileId === 'string') job = { fileId: parsed.fileId };
  } catch {
    job = null;
  }
  return {
    job,
    receiptHandle: m.ReceiptHandle ?? '',
    receiveCount: Number(m.Attributes?.ApproximateReceiveCount ?? '1'),
    messageId: m.MessageId ?? '',
  };
}
