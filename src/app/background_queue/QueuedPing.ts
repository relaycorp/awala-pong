export interface QueuedPing {
  readonly gatewayAddress: string;
  readonly parcelId: string;
  readonly parcelSenderCertificate: string;
  readonly parcelPayload: string;
}
