import type {
  Address,
  EmailContact,
  Phone,
  PhoneType,
  RelatedPerson,
  Shareholding,
  Vehicle,
} from '../../contracts/types/canonical/shared.types.js';
import { asList } from '../../contracts/utils/array.util.js';
import { asRecord, readBoolean, readNumber, readString } from './read.util.js';

export function normalizePhoneItem(raw: unknown, defaultType: PhoneType | null = null): Phone {
  const record = asRecord(raw);
  const explicitType = readString(record.type, record.tipo, record.phoneType)?.toLowerCase();
  let type: PhoneType | null = defaultType;
  if (explicitType?.includes('mobile') || explicitType?.includes('celular')) type = 'mobile';
  if (explicitType?.includes('landline') || explicitType?.includes('fix')) type = 'landline';

  return {
    ddd: readNumber(record.ddd, record.areaCode, record.DDD),
    number: readString(record.number, record.numero, record.Number, record.phone),
    type,
    ranking: readNumber(record.ranking, record.Ranking, record.rank),
    whatsapp: readBoolean(record.whatsapp ?? record.hasWhatsapp ?? record.WhatsApp),
    plus: readBoolean(record.plus ?? record.Plus),
  };
}

export function normalizePhoneList(items: unknown, defaultType: PhoneType | null = null): Phone[] {
  return asList(items)
    .map((item) => normalizePhoneItem(item, defaultType))
    .filter((item) => item.number != null || item.ddd != null);
}

export function normalizeEmailItem(raw: unknown): EmailContact {
  const record = asRecord(raw);
  return {
    email: readString(record.email, record.Email, record.address),
    ranking: readNumber(record.ranking, record.Ranking, record.rank),
    hasCookie: readBoolean(record.hasCookie ?? record.possui_cookie ?? record.HasCookie),
  };
}

export function normalizeEmailList(items: unknown): EmailContact[] {
  return asList(items)
    .map(normalizeEmailItem)
    .filter((item) => item.email != null);
}

export function normalizeAddressItem(raw: unknown): Address {
  const record = asRecord(raw);
  return {
    line: readString(record.line, record.endereco, record.address, record.Address),
    streetType: readString(record.streetType, record.tipo_logradouro),
    streetTitle: readString(record.streetTitle, record.titulo_logradouro),
    street: readString(record.street, record.logradouro, record.Street),
    number: readString(record.number, record.numero, record.Number),
    complement: readString(record.complement, record.complemento, record.Complement),
    neighborhood: readString(record.neighborhood, record.bairro, record.Neighborhood),
    city: readString(record.city, record.cidade, record.City),
    state: readString(record.state, record.uf, record.State),
    zipCode: readString(record.zipCode, record.cep, record.ZipCode, record.postalCode),
    type: readString(record.type, record.tipo, record.Type),
    ranking: readNumber(record.ranking, record.Ranking, record.rank),
  };
}

export function normalizeAddressList(items: unknown): Address[] {
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    const single = normalizeAddressItem(items);
    if (single.line || single.city || single.zipCode) return [single];
    return [];
  }
  return asList(items)
    .map(normalizeAddressItem)
    .filter((item) => item.line != null || item.city != null || item.zipCode != null);
}

export function normalizeVehicleItem(raw: unknown): Vehicle {
  const record = asRecord(raw);
  return {
    plate: readString(record.plate, record.placa, record.Plate),
    makeModel: readString(record.makeModel, record.marca, record.MakeModel, record.brand),
    manufactureYear: readNumber(record.manufactureYear, record.ano_fabricacao, record.Year),
    modelYear: readNumber(record.modelYear, record.ano_modelo, record.ModelYear),
    renavam: readString(record.renavam, record.renavan, record.Renavam),
    chassis: readString(record.chassis, record.chassi, record.Chassis),
    licensingDate: readString(
      record.licensingDate,
      record.data_licenciamento,
      record.LicensingDate,
    ),
    ranking: readNumber(record.ranking, record.Ranking, record.rank),
  };
}

export function normalizeVehicleList(items: unknown): Vehicle[] {
  return asList(items)
    .map(normalizeVehicleItem)
    .filter((item) => item.plate != null || item.chassis != null);
}

export function normalizeRelatedPersonItem(raw: unknown): RelatedPerson {
  const record = asRecord(raw);
  return {
    document: readString(
      record.document,
      record.cpf_vinculo,
      record.cpf,
      record.cnpj,
      record.TaxIdNumber,
    ),
    name: readString(record.name, record.nome_vinculo, record.nome, record.Name),
    relationType: readString(
      record.relationType,
      record.tipo_vinculo,
      record.relationship,
      record.type,
    ),
  };
}

export function normalizeRelatedPeopleList(items: unknown): RelatedPerson[] {
  return asList(items)
    .map(normalizeRelatedPersonItem)
    .filter((item) => item.name != null || item.document != null);
}

export function normalizeShareholdingItem(raw: unknown): Shareholding {
  const record = asRecord(raw);
  return {
    name: readString(record.name, record.nome, record.Name, record.razao_social),
    document: readString(record.document, record.cnpj, record.cpf, record.TaxIdNumber),
    capital: readNumber(record.capital, record.capital_social, record.Capital),
    sharePercent: readNumber(
      record.sharePercent,
      record.participacao_socio,
      record.participacao,
      record.ParticipationPercentage,
    ),
    foundedDate: readString(record.foundedDate, record.data_fundacao, record.FoundedDate),
    cadastralStatus: readString(
      record.cadastralStatus,
      record.situacao_cadastral,
      record.status,
      record.TaxIdStatus,
    ),
  };
}

export function normalizeShareholdingList(items: unknown): Shareholding[] {
  return asList(items)
    .map(normalizeShareholdingItem)
    .filter((item) => item.name != null || item.document != null);
}

const PHONES_PATH = 'sections.cadastral.phones';
const MOBILE_PATH = 'sections.cadastral.mobilePhones';
const LANDLINE_PATH = 'sections.cadastral.landlinePhones';
const EMAILS_PATH = 'sections.cadastral.emails';
const ADDRESSES_PATH = 'sections.cadastral.addresses';
const VEHICLES_PATH = 'sections.cadastral.vehicles';
const RELATED_PATH = 'sections.corporateLinks.relatedPeople';
const SHAREHOLDINGS_PATH = 'sections.corporateLinks.shareholdings';
const CREDIT_FLAGS_PATH = 'sections.financial.creditFlags';
const RISK_LEVEL_PATH = 'sections.financial.financialRiskLevel';

export function normalizeContactsInMapped(mapped: Record<string, unknown>): void {
  const mobiles = normalizePhoneList(mapped[MOBILE_PATH], 'mobile');
  const landlines = normalizePhoneList(mapped[LANDLINE_PATH], 'landline');
  const existingPhones = normalizePhoneList(mapped[PHONES_PATH], null);
  const phones = [...existingPhones, ...mobiles, ...landlines];
  if (phones.length > 0) {
    mapped[PHONES_PATH] = phones;
  }
  delete mapped[MOBILE_PATH];
  delete mapped[LANDLINE_PATH];

  if (mapped[EMAILS_PATH] != null) {
    mapped[EMAILS_PATH] = normalizeEmailList(mapped[EMAILS_PATH]);
  }
  if (mapped[ADDRESSES_PATH] != null) {
    mapped[ADDRESSES_PATH] = normalizeAddressList(mapped[ADDRESSES_PATH]);
  }
  if (mapped[VEHICLES_PATH] != null) {
    mapped[VEHICLES_PATH] = normalizeVehicleList(mapped[VEHICLES_PATH]);
  }
  if (mapped[RELATED_PATH] != null) {
    mapped[RELATED_PATH] = normalizeRelatedPeopleList(mapped[RELATED_PATH]);
  }
  if (mapped[SHAREHOLDINGS_PATH] != null) {
    mapped[SHAREHOLDINGS_PATH] = normalizeShareholdingList(mapped[SHAREHOLDINGS_PATH]);
  }

  const creditFlags = mapped[CREDIT_FLAGS_PATH];
  if (typeof creditFlags === 'string' && creditFlags.trim()) {
    mapped[CREDIT_FLAGS_PATH] = [creditFlags.trim()];
  } else if (Array.isArray(creditFlags)) {
    mapped[CREDIT_FLAGS_PATH] = creditFlags
      .map((flag) => (typeof flag === 'string' ? flag.trim() : String(flag)))
      .filter(Boolean);
  }

  const riskLevel = mapped[RISK_LEVEL_PATH];
  if (typeof riskLevel === 'string' && riskLevel.trim()) {
    mapped[RISK_LEVEL_PATH] = riskLevel.trim();
  }
}
