import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { v4 as uuid } from 'uuid';

@Injectable()
export class StorageService implements OnModuleInit {
  private client: Minio.Client;
  private bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('minio.bucket', 'vehicle-marketplace');
    this.client = new Minio.Client({
      endPoint: this.configService.get<string>('minio.endpoint', 'localhost'),
      port: this.configService.get<number>('minio.port', 9000),
      useSSL: this.configService.get<boolean>('minio.useSSL', false),
      accessKey: this.configService.get<string>('minio.accessKey', 'minio_access_key'),
      secretKey: this.configService.get<string>('minio.secretKey', 'minio_secret_key'),
    });
  }

  async onModuleInit() {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async upload(
    file: Buffer,
    originalName: string,
    mimetype: string,
    folder: string = 'uploads',
  ): Promise<{ key: string; url: string }> {
    const extension = originalName.split('.').pop();
    const key = `${folder}/${uuid()}.${extension}`;

    await this.client.putObject(this.bucket, key, file, file.length, {
      'Content-Type': mimetype,
    });

    const url = await this.getPublicUrl(key);
    return { key, url };
  }

  async getSignedUrl(key: string, expirySeconds: number = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expirySeconds);
  }

  async getPublicUrl(key: string): Promise<string> {
    const endpoint = this.configService.get<string>('minio.endpoint', 'localhost');
    const port = this.configService.get<number>('minio.port', 9000);
    const useSSL = this.configService.get<boolean>('minio.useSSL', false);
    const protocol = useSSL ? 'https' : 'http';
    return `${protocol}://${endpoint}:${port}/${this.bucket}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async getUploadSignedUrl(
    folder: string,
    filename: string,
    expirySeconds: number = 3600,
  ): Promise<{ key: string; uploadUrl: string }> {
    const extension = filename.split('.').pop();
    const key = `${folder}/${uuid()}.${extension}`;
    const uploadUrl = await this.client.presignedPutObject(this.bucket, key, expirySeconds);
    return { key, uploadUrl };
  }
}
