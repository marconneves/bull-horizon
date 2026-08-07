import { BullMonitorExpress } from '@bull-horizon/express';
import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { BullAdapter } from '@bull-horizon/root/dist/bull-adapter';

@Injectable()
export class BullMonitorService extends BullMonitorExpress {
  constructor(@InjectQueue('person') personQueue: Queue) {
    super({ queues: [new BullAdapter(personQueue)] });
  }
}
