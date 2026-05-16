import {
  IsBoolean, IsIn, IsOptional, IsString, MaxLength,
} from 'class-validator';

export class AddZigbeeDeviceDto {
  @IsString() zigbeeIeee: string;
  @IsString() @IsOptional() friendlyName?: string;
  @IsString() @IsOptional() zigbeeModel?: string;
  @IsString() @MaxLength(100) name: string;
  @IsString() category: string;
  @IsIn(['sensor', 'actuator']) deviceType: string;
  @IsOptional() @IsString() equipmentType?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() houseId?: string;
  @IsOptional() @IsString() pairedDeviceId?: string;
  @IsOptional() @IsString() openerGroupName?: string;
  @IsOptional() @IsBoolean() online?: boolean;
}

export class UpdateZigbeeDeviceDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() houseId?: string;
  @IsOptional() channelMapping?: Record<string, string>;
  @IsOptional() deviceSettings?: Record<string, any>;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
