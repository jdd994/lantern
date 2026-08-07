// web-bluetooth.d.ts
// The slice of Web Bluetooth that strap.ts actually uses — TypeScript's DOM lib
// doesn't ship these. Deliberately minimal rather than a dependency on
// @types/web-bluetooth: the surface we touch is four types deep, and a local
// declaration keeps the app at zero runtime-adjacent dependencies, same
// instinct as writing the crypto against WebCrypto directly.

interface Navigator {
  readonly bluetooth: Bluetooth;
}

interface Bluetooth {
  requestDevice(options: {
    filters: { services?: string[]; namePrefix?: string }[];
    optionalServices?: string[];
  }): Promise<BluetoothDevice>;
}

interface BluetoothDevice extends EventTarget {
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly value?: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
}
