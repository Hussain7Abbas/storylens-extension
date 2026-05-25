import {
	ActionIcon,
	Badge,
	Button,
	Container,
	Divider,
	Group,
	PasswordInput,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconPencil } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useRoutes } from "@/hooks/useRoutes";
import {
	type AuthUser,
	authStateAtom,
	checkUsernameAvailability,
	clearAuth,
	loginWithEmail,
	registerAccount,
	updateProfile,
	userRoleAtom,
} from "@/lib/auth";

type AuthView = "profile" | "login" | "register";

export function ProfilePage() {
	const { t } = useTranslation();
	const { goHome } = useRoutes();
	const [authState, setAuthState] = useAtom(authStateAtom);
	const role = useAtomValue(userRoleAtom);
	const [view, setView] = useState<AuthView>("profile");

	const user = authState.user;

	const handleLogout = async () => {
		await clearAuth();
		setAuthState({ user: null, token: null });
		toast.success(t("auth.logoutSuccess"));
	};

	if (view === "login") {
		return (
			<Container p="md">
				<LoginForm
					onBack={() => setView("profile")}
					onSuccess={(data) => {
						setAuthState({ user: data.user, token: data.token });
						goHome();
					}}
				/>
			</Container>
		);
	}

	if (view === "register") {
		return (
			<Container p="md">
				<RegisterForm
					currentUsername={user?.username}
					onBack={() => setView("profile")}
					onSuccess={(data) => {
						setAuthState({
							user: data.user,
							token: data.token,
						});
						setView("profile");
					}}
				/>
			</Container>
		);
	}

	const roleBadgeColor =
		role === "admin" ? "red" : role === "user" ? "blue" : "gray";
	const roleBadgeLabel =
		role === "admin"
			? t("auth.adminBadge")
			: role === "user"
				? t("auth.userBadge")
				: t("auth.guestBadge");

	return (
		<Container p="md">
			<Stack gap="md">
				<Group justify="space-between">
					<Title order={4}>{t("navbar.profile")}</Title>
					<Badge color={roleBadgeColor} variant="light">
						{roleBadgeLabel}
					</Badge>
				</Group>

				{user && role === "guest" && (
					<Stack gap="xs">
						<Group gap="xs">
							<Text size="sm" fw={500} w={80}>
								{t("auth.username")}:
							</Text>
							<Text size="sm">{user.username}</Text>
						</Group>
					</Stack>
				)}

				{user && role !== "guest" && (
					<ProfileDetails
						user={user}
						onUpdated={(updatedUser) => {
							setAuthState({
								user: updatedUser,
								token: authState.token,
							});
						}}
					/>
				)}

				<Divider />

				{role === "guest" ? (
					<Stack gap="xs">
						<Text size="xs" c="dimmed">
							{t("auth.loginSuccess")}
						</Text>
						<Group grow>
							<Button
								variant="light"
								onClick={() => setView("login")}
							>
								{t("auth.login")}
							</Button>
							<Button
								variant="filled"
								onClick={() => setView("register")}
							>
								{t("auth.register")}
							</Button>
						</Group>
					</Stack>
				) : (
					<Button
						variant="light"
						color="red"
						onClick={() => void handleLogout()}
					>
						{t("auth.logout")}
					</Button>
				)}
			</Stack>
		</Container>
	);
}

function ProfileField({ label, value }: { label: string; value: string }) {
	return (
		<Group gap="xs" wrap="nowrap" align="flex-start">
			<Text size="sm" fw={500} w={80}>
				{label}:
			</Text>
			<Text size="sm" style={{ flex: 1 }}>
				{value}
			</Text>
		</Group>
	);
}

function ProfileDetails({
	user,
	onUpdated,
}: {
	user: AuthUser;
	onUpdated: (user: AuthUser) => void;
}) {
	const { t } = useTranslation();
	const [isEditing, setIsEditing] = useState(false);
	const [loading, setLoading] = useState(false);

	const form = useForm({
		initialValues: {
			username: user.username,
			name: user.name,
		},
		validate: {
			username: (value) =>
				value.length < 3 ? t("onboarding.usernameTooShort") : null,
			name: (value) => (!value.trim() ? t("auth.nameRequired") : null),
		},
	});

	const handleCancel = () => {
		form.setValues({
			username: user.username,
			name: user.name,
		});
		form.clearErrors();
		setIsEditing(false);
	};

	const handleSubmit = async (values: typeof form.values) => {
		const username = values.username.trim();
		const name = values.name.trim();

		if (username !== user.username) {
			const available = await checkUsernameAvailability(username);
			if (!available) {
				form.setFieldError("username", t("onboarding.usernameTaken"));
				return;
			}
		}

		setLoading(true);
		try {
			const updatedUser = await updateProfile({ username, name });
			toast.success(t("auth.profileUpdated"));
			onUpdated(updatedUser);
			setIsEditing(false);
		} catch {
			toast.error(t("auth.profileUpdateFailed"));
		} finally {
			setLoading(false);
		}
	};

	if (!isEditing) {
		return (
			<Group justify="space-between" align="flex-start" wrap="nowrap">
				<Stack gap="xs" style={{ flex: 1 }}>
					<ProfileField label={t("auth.username")} value={user.username} />
					<ProfileField label={t("auth.name")} value={user.name} />
					<ProfileField label={t("auth.email")} value={user.email} />
				</Stack>
				<Tooltip label={t("_.edit")} withArrow>
					<ActionIcon
						variant="subtle"
						size="lg"
						aria-label={t("_.edit")}
						onClick={() => setIsEditing(true)}
					>
						<IconPencil size={18} stroke={1.5} />
					</ActionIcon>
				</Tooltip>
			</Group>
		);
	}

	return (
		<form onSubmit={form.onSubmit((values) => void handleSubmit(values))}>
			<Stack gap="sm">
				<TextInput
					label={t("auth.username")}
					{...form.getInputProps("username")}
				/>
				<TextInput label={t("auth.name")} {...form.getInputProps("name")} />
				<TextInput
					label={t("auth.email")}
					value={user.email}
					readOnly
					disabled
				/>
				<Group grow>
					<Button
						type="button"
						variant="outline"
						onClick={handleCancel}
						disabled={loading}
					>
						{t("_.cancel")}
					</Button>
					<Button type="submit" loading={loading}>
						{t("_.save")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}

function LoginForm({
	onBack,
	onSuccess,
}: {
	onBack: () => void;
	onSuccess: (data: {
		user: { id: string; email: string; username: string; name: string; role: 'guest' | 'user' | 'admin' };
		token: string;
	}) => void;
}) {
	const { t } = useTranslation();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		initialValues: { email: "", password: "" },
		validate: {
			email: (v) => (!v ? t("auth.email") : null),
			password: (v) => (!v ? t("auth.password") : null),
		},
	});

	const handleSubmit = async (values: typeof form.values) => {
		setLoading(true);
		try {
			const result = await loginWithEmail(values.email, values.password);
			toast.success(t("auth.loginSuccess"));
			onSuccess(result);
		} catch {
			toast.error(t("auth.loginFailed"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
			<Stack gap="sm">
				<Title order={4}>{t("auth.login")}</Title>
				<TextInput
					label={t("auth.email")}
					type="email"
					{...form.getInputProps("email")}
				/>
				<PasswordInput
					label={t("auth.password")}
					{...form.getInputProps("password")}
				/>
				<Group grow>
					<Button variant="outline" onClick={onBack} disabled={loading}>
						{t("_.cancel")}
					</Button>
					<Button type="submit" loading={loading}>
						{t("auth.login")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}

function RegisterForm({
	currentUsername,
	onBack,
	onSuccess,
}: {
	currentUsername?: string;
	onBack: () => void;
	onSuccess: (data: {
		user: { id: string; email: string; username: string; name: string; role: 'guest' | 'user' | 'admin' };
		token: string;
	}) => void;
}) {
	const { t } = useTranslation();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		initialValues: {
			email: "",
			password: "",
			username: currentUsername ?? "",
			name: "",
		},
		validate: {
			email: (v) => (!v ? t("auth.email") : null),
			password: (v) => (v.length < 8 ? "Min 8 characters" : null),
			username: (v) => (v.length < 3 ? t("onboarding.usernameTooShort") : null),
		},
	});

	const handleSubmit = async (values: typeof form.values) => {
		setLoading(true);
		try {
			const result = await registerAccount({
				email: values.email,
				password: values.password,
				username: values.username,
				name: values.name || values.username,
			});
			toast.success(t("auth.registerSuccess"));
			onSuccess(result);
		} catch {
			toast.error(t("auth.registerFailed"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
			<Stack gap="sm">
				<Title order={4}>{t("auth.register")}</Title>
				<TextInput
					label={t("auth.email")}
					type="email"
					{...form.getInputProps("email")}
				/>
				<TextInput
					label={t("auth.username")}
					{...form.getInputProps("username")}
				/>
				<TextInput
					label={t("auth.name")}
					{...form.getInputProps("name")}
				/>
				<PasswordInput
					label={t("auth.password")}
					{...form.getInputProps("password")}
				/>
				<Group grow>
					<Button variant="outline" onClick={onBack} disabled={loading}>
						{t("_.cancel")}
					</Button>
					<Button type="submit" loading={loading}>
						{t("auth.register")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}
