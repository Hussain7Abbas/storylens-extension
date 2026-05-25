import {
	Button,
	Container,
	Group,
	Stack,
	Stepper,
	Text,
	TextInput,
	ThemeIcon,
	Title,
} from "@mantine/core";
import {
	IconBook,
	IconCheck,
	IconPalette,
	IconUser,
} from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { axiosInstance } from "@/api/axios-instance";
import {
	authStateAtom,
	checkUsernameAvailability,
	onboardingCompletedAtom,
	storeAuth,
} from "@/lib/auth";

export function Onboarding() {
	const { t } = useTranslation();
	const [active, setActive] = useState(0);
	const [, setOnboardingCompleted] = useAtom(onboardingCompletedAtom);
	const [authState, setAuthState] = useAtom(authStateAtom);
	const [username, setUsername] = useState(authState.user?.username ?? "");
	const [usernameError, setUsernameError] = useState("");
	const [checking, setChecking] = useState(false);

	const nextStep = () => setActive((c) => Math.min(c + 1, 2));
	const prevStep = () => setActive((c) => Math.max(c - 1, 0));

	const handleUsernameChange = (value: string) => {
		setUsername(value);
		setUsernameError("");
	};

	const handleUsernameSubmit = async () => {
		if (username.length < 3) {
			setUsernameError(t("onboarding.usernameTooShort"));
			return;
		}

		if (username === authState.user?.username) {
			nextStep();
			return;
		}

		setChecking(true);
		try {
			const available = await checkUsernameAvailability(username);
			if (!available) {
				setUsernameError(t("onboarding.usernameTaken"));
				return;
			}

			const response = await axiosInstance.put<{
				id: string;
				email: string;
				username: string;
				name: string;
				role: "guest" | "user" | "admin";
			}>("/auth/me", { username, name: username });

			const updatedUser = response.data;
			setAuthState({ user: updatedUser, token: authState.token });
			await storeAuth(updatedUser, authState.token ?? "");
			nextStep();
		} catch {
			setUsernameError(t("onboarding.usernameUpdateFailed"));
		} finally {
			setChecking(false);
		}
	};

	const handleComplete = () => {
		setOnboardingCompleted(true);
		void browser.storage.local.set({ "storylens-onboarding-completed": true });
	};

	return (
		<Container p="md" h="100%">
			<Stack h="100%" justify="space-between">
				<Stepper active={active} size="xs">
					<Stepper.Step label={t("onboarding.welcome")}>
						<WelcomePage />
					</Stepper.Step>
					<Stepper.Step label={t("onboarding.profile")}>
						<ProfileSetupPage
							username={username}
							error={usernameError}
							onChange={handleUsernameChange}
						/>
					</Stepper.Step>
					<Stepper.Step label={t("onboarding.start")}>
						<GettingStartedPage />
					</Stepper.Step>
				</Stepper>

				<Group justify="space-between" mt="md">
					{active > 0 ? (
						<Button variant="subtle" onClick={prevStep} size="xs">
							{t("onboarding.back")}
						</Button>
					) : (
						<div />
					)}

					{active === 0 && (
						<Button onClick={nextStep} size="xs">
							{t("onboarding.next")}
						</Button>
					)}

					{active === 1 && (
						<Button onClick={handleUsernameSubmit} loading={checking} size="xs">
							{t("onboarding.next")}
						</Button>
					)}

					{active === 2 && (
						<Button
							onClick={handleComplete}
							size="xs"
							leftSection={<IconCheck size={14} />}
						>
							{t("onboarding.finish")}
						</Button>
					)}
				</Group>
			</Stack>
		</Container>
	);
}

function WelcomePage() {
	const { t } = useTranslation();

	return (
		<Stack align="center" gap="md" pt="lg">
			<ThemeIcon size={60} radius="xl" variant="light" color="blue">
				<IconBook size={30} />
			</ThemeIcon>
			<Title order={3} ta="center">
				{t("onboarding.welcomeTitle")}
			</Title>
			<Text size="sm" c="dimmed" ta="center" maw={280}>
				{t("onboarding.welcomeDescription")}
			</Text>
		</Stack>
	);
}

function ProfileSetupPage({
	username,
	error,
	onChange,
}: {
	username: string;
	error: string;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslation();

	return (
		<Stack align="center" gap="md" pt="lg">
			<ThemeIcon size={60} radius="xl" variant="light" color="teal">
				<IconUser size={30} />
			</ThemeIcon>
			<Title order={4} ta="center">
				{t("onboarding.profileTitle")}
			</Title>
			<Text size="xs" c="dimmed" ta="center" maw={280}>
				{t("onboarding.profileDescription")}
			</Text>
			<TextInput
				label={t("onboarding.username")}
				value={username}
				onChange={(e) => onChange(e.currentTarget.value)}
				error={error}
				w="100%"
				maw={250}
			/>
		</Stack>
	);
}

function GettingStartedPage() {
	const { t } = useTranslation();

	return (
		<Stack align="center" gap="md" pt="lg">
			<ThemeIcon size={60} radius="xl" variant="light" color="grape">
				<IconPalette size={30} />
			</ThemeIcon>
			<Title order={4} ta="center">
				{t("onboarding.startTitle")}
			</Title>
			<Stack gap="xs" maw={280}>
				<Text size="xs" c="dimmed">
					{t("onboarding.startStep1")}
				</Text>
				<Text size="xs" c="dimmed">
					{t("onboarding.startStep2")}
				</Text>
				<Text size="xs" c="dimmed">
					{t("onboarding.startStep3")}
				</Text>
			</Stack>
		</Stack>
	);
}
