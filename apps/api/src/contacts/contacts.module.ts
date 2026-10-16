import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Permissions, AllowAuthenticated } from '../common/decorators';
import { AuthUser } from '../common/rbac.guard';

// Company contacts (customers). Accessible to agents (a core agent capability),
// and to managers/admins. Tenant-scoped.
@Permissions('contacts')
@Controller('contacts')
export class ContactsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('q') q?: string, @Query('group') group?: string) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        tenantId: u.tenantId,
        ...(group ? { groupIds: { has: group } } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    // Enrich with the most recent call: last contacted + last disposition. Match
    // by contactId first, then fall back to the phone's last 9 digits.
    const d9 = (s?: string | null) => (s || '').replace(/\D/g, '').slice(-9);
    const logs = await this.prisma.callLog.findMany({
      where: { tenantId: u.tenantId },
      orderBy: { startedAt: 'desc' },
      take: 3000,
      select: { contactId: true, peerNumber: true, startedAt: true, disposition: true },
    });
    const byContact = new Map<string, { at: Date; disp: string | null }>();
    const byPhone = new Map<string, { at: Date; disp: string | null }>();
    for (const l of logs) {
      if (l.contactId && !byContact.has(l.contactId)) byContact.set(l.contactId, { at: l.startedAt, disp: l.disposition });
      const p = d9(l.peerNumber);
      if (p && !byPhone.has(p)) byPhone.set(p, { at: l.startedAt, disp: l.disposition });
    }
    return contacts.map((c) => {
      const info = byContact.get(c.id) || (c.phone ? byPhone.get(d9(c.phone)) : undefined);
      return { ...c, lastContactedAt: info?.at ?? null, lastDisposition: info?.disp ?? null };
    });
  }

  // Console lookup by phone/extension. Extensions (short numbers) match exactly;
  // real phone numbers match on the last 9 digits to tolerate country-code /
  // formatting differences. NOT a substring match — "10" must not match "1002".
  @Get('lookup')
  async lookup(@CurrentUser() u: AuthUser, @Query('phone') phone?: string) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    const where = digits.length >= 10
      ? { tenantId: u.tenantId, phone: { endsWith: digits.slice(-9) } }
      : { tenantId: u.tenantId, phone };
    const rows = await this.prisma.contact.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 1 });
    return rows[0] ?? null;
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() b: { name?: string; phone?: string; email?: string; company?: string; notes?: string; groupIds?: string[]; customFields?: any }) {
    return this.prisma.contact.create({
      data: {
        tenantId: u.tenantId, name: b.name, phone: b.phone, email: b.email, company: b.company, notes: b.notes,
        groupIds: b.groupIds ?? [], customFields: b.customFields ?? {},
      },
    });
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const data: Record<string, unknown> = {};
    for (const k of ['name', 'phone', 'email', 'company', 'notes', 'groupIds', 'customFields'] as const) {
      if (b[k] !== undefined) data[k] = b[k];
    }
    await this.prisma.contact.updateMany({ where: { id, tenantId: u.tenantId }, data });
    return this.prisma.contact.findFirst({ where: { id, tenantId: u.tenantId } });
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.contact.deleteMany({ where: { id, tenantId: u.tenantId } });
  }

  // Bulk-create contacts (from a CSV import parsed + mapped client-side). Each row
  // may name its own group (the file's Group column): the name is matched to an
  // existing group case-insensitively, or a new group is created for it. An
  // optional groupId additionally adds every row to that group. Capped so a bad
  // upload can't hammer the DB.
  @Post('import')
  async import(@CurrentUser() u: AuthUser, @Body() b: { contacts?: Array<{ name?: string; phone?: string; email?: string; company?: string; group?: string; customFields?: any }>; groupId?: string }) {
    const wanted = (b.contacts ?? [])
      .filter((c) => (c.phone && c.phone.trim()) || (c.name && c.name.trim()))
      .slice(0, 10000);

    // Resolve every distinct group name in the file up front (max 200 new groups
    // per import so a mis-mapped column can't create thousands).
    const existing = await this.prisma.contactGroup.findMany({ where: { tenantId: u.tenantId } });
    const byName = new Map(existing.map((g) => [g.name.trim().toLowerCase(), g.id]));
    const names = [...new Set(wanted.map((c) => (c.group ?? '').trim()).filter(Boolean))];
    let createdGroups = 0;
    for (const name of names) {
      const key = name.toLowerCase();
      if (byName.has(key)) continue;
      if (createdGroups >= 200) break;
      const g = await this.prisma.contactGroup.create({ data: { tenantId: u.tenantId, name } });
      byName.set(key, g.id);
      createdGroups++;
    }

    const rows = wanted.map((c) => {
      const own = byName.get((c.group ?? '').trim().toLowerCase());
      return {
        tenantId: u.tenantId,
        name: c.name?.trim() || null,
        phone: c.phone?.trim() || null,
        email: c.email?.trim() || null,
        company: c.company?.trim() || null,
        customFields: c.customFields ?? {},
        groupIds: [...new Set([b.groupId, own].filter(Boolean))] as string[],
      };
    });
    if (!rows.length) return { created: 0, createdGroups };
    const res = await this.prisma.contact.createMany({ data: rows });
    return { created: res.count, createdGroups };
  }
}

// Contact groups (segments/lists). Each returned group includes a live member count.
@Permissions('contacts')
@Controller('contact-groups')
export class ContactGroupsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const groups = await this.prisma.contactGroup.findMany({ where: { tenantId: u.tenantId }, orderBy: { createdAt: 'asc' } });
    return Promise.all(groups.map(async (g) => ({
      ...g,
      count: await this.prisma.contact.count({ where: { tenantId: u.tenantId, groupIds: { has: g.id } } }),
    })));
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() b: { name?: string; color?: string }) {
    return this.prisma.contactGroup.create({ data: { tenantId: u.tenantId, name: (b.name || '').trim() || 'New group', color: b.color } });
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { name?: string; color?: string }) {
    await this.prisma.contactGroup.updateMany({ where: { id, tenantId: u.tenantId }, data: { name: b.name, color: b.color } });
    return this.prisma.contactGroup.findFirst({ where: { id, tenantId: u.tenantId } });
  }

  // Delete the group and strip its id from every contact's groupIds.
  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const members = await this.prisma.contact.findMany({ where: { tenantId: u.tenantId, groupIds: { has: id } }, select: { id: true, groupIds: true } });
    await Promise.all(members.map((m) =>
      this.prisma.contact.update({ where: { id: m.id }, data: { groupIds: m.groupIds.filter((g) => g !== id) } }),
    ));
    return this.prisma.contactGroup.deleteMany({ where: { id, tenantId: u.tenantId } });
  }
}

// Tenant-defined custom fields for contacts/leads. Agents read them (to render
// contact forms); managers define them.
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private prisma: PrismaService) {}

  @AllowAuthenticated()
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.customField.findMany({ where: { tenantId: u.tenantId }, orderBy: { order: 'asc' } });
  }

  @Permissions('contacts')
  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() b: { label?: string; type?: string; options?: string[] }) {
    const label = (b.label || '').trim() || 'Field';
    const type = ['text', 'number', 'date', 'select'].includes(b.type || '') ? b.type! : 'text';
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
    let key = base, n = 1;
    while (await this.prisma.customField.findFirst({ where: { tenantId: u.tenantId, key } })) key = `${base}_${++n}`;
    const order = await this.prisma.customField.count({ where: { tenantId: u.tenantId } });
    return this.prisma.customField.create({ data: { tenantId: u.tenantId, key, label, type, options: b.options ?? [], order } });
  }

  @Permissions('contacts')
  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const data: Record<string, unknown> = {};
    for (const k of ['label', 'type', 'options', 'order'] as const) if (b[k] !== undefined) data[k] = b[k];
    await this.prisma.customField.updateMany({ where: { id, tenantId: u.tenantId }, data });
    return this.prisma.customField.findFirst({ where: { id, tenantId: u.tenantId } });
  }

  @Permissions('contacts')
  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.customField.deleteMany({ where: { id, tenantId: u.tenantId } });
  }
}

@Module({ controllers: [ContactsController, ContactGroupsController, CustomFieldsController] })
export class ContactsModule {}
