import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { InfraModule } from './infra/infra.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [ConfigModule.forRoot(), InfraModule, UploadsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
