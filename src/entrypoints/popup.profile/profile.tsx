import {
  Avatar,
  Button,
  Center,
  Container,
  Group,
  NumberInput,
  Select,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';

export function ProfilePage() {
  const form = useForm({
    initialValues: {
      age: 20,
      avatar: 'https://images.loremflickr.com/640/480/people',
      gender: 'ذكر',
      name: 'Hussain Abbas',
    },
  });

  return (
    <Container p="md">
      <Center>
        <Avatar src={form.values.avatar} size={120} radius={120} />
      </Center>
      <TextInput label="الاسم" {...form.getInputProps('name')} />
      <NumberInput label="العمر" min={0} {...form.getInputProps('age')} />
      <Select
        label="الجنس"
        data={['ذكر', 'انثى']}
        {...form.getInputProps('gender')}
      />
      <Group mt="md" grow>
        <Button variant="light" color="green.7">
          تعديل
        </Button>
        <Button variant="light" color="red.7">
          تغيير كلمة المرور
        </Button>
      </Group>
    </Container>
  );
}
